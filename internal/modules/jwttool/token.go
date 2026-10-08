package jwttool

import (
	"bytes"
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/example/repodock/internal/domain"
)

const (
	AlgRS256 = "RS256"
	AlgHS256 = "HS256"
)

var b64 = base64.RawURLEncoding

// Generate signs a token with the payload shape of the previous generator
// script: id, userId/userName/name (email), deviceId, realm,
// resource_access.roles, channel, plus iat/exp/iss/sub. Extra claims are
// merged over it.
func Generate(settings domain.JWTSettings, now time.Time) (domain.JWTToken, error) {
	settings = Normalize(settings)
	id, email := strings.TrimSpace(settings.ID), strings.TrimSpace(settings.Email)
	if id == "" {
		return domain.JWTToken{}, errors.New("ID is required")
	}
	if email == "" {
		return domain.JWTToken{}, errors.New("email is required")
	}
	if settings.ExpiresInDays <= 0 {
		return domain.JWTToken{}, errors.New("expiry must be more than 0 days")
	}
	issued := now.Unix()
	expires := issued + int64(settings.ExpiresInDays*86400)

	payload := map[string]any{
		"id":              id,
		"userId":          email,
		"userName":        email,
		"name":            email,
		"resource_access": map[string]any{"roles": settings.SelectedRoles},
		"iat":             issued,
		"exp":             expires,
	}
	for key, value := range map[string]string{"deviceId": settings.DeviceID, "realm": settings.Realm, "channel": settings.Channel, "iss": settings.Issuer, "sub": settings.Subject} {
		if value = strings.TrimSpace(value); value != "" {
			payload[key] = value
		}
	}
	if extra := strings.TrimSpace(settings.ExtraClaims); extra != "" {
		var claims map[string]any
		if err := json.Unmarshal([]byte(extra), &claims); err != nil {
			return domain.JWTToken{}, fmt.Errorf("extra claims must be a JSON object: %w", err)
		}
		for key, value := range claims {
			payload[key] = value
		}
	}

	header, _ := json.Marshal(map[string]string{"alg": settings.Algorithm, "typ": "JWT"})
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.JWTToken{}, err
	}
	signingInput := b64.EncodeToString(header) + "." + b64.EncodeToString(body)
	signature, err := sign(settings, []byte(signingInput))
	if err != nil {
		return domain.JWTToken{}, err
	}
	expiresAt := time.Unix(expires, 0).UTC().Format(time.RFC3339)
	if exp, ok := payload["exp"].(float64); ok { // overridden by extra claims
		expiresAt = time.Unix(int64(exp), 0).UTC().Format(time.RFC3339)
	}
	return domain.JWTToken{Token: signingInput + "." + b64.EncodeToString(signature), Payload: pretty(body), ExpiresAt: expiresAt}, nil
}

func sign(settings domain.JWTSettings, input []byte) ([]byte, error) {
	if settings.Algorithm == AlgHS256 {
		if settings.Secret == "" {
			return nil, errors.New("HS256 needs a secret")
		}
		mac := hmac.New(sha256.New, []byte(settings.Secret))
		mac.Write(input)
		return mac.Sum(nil), nil
	}
	key, err := parsePrivateKey(settings.PrivateKey)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(input)
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return nil, fmt.Errorf("sign token: %w", err)
	}
	return signature, nil
}

// Decode parses a token and, when the settings hold a matching key, checks
// its signature. A malformed token is an error; a bad signature is not.
func Decode(token string, settings domain.JWTSettings, now time.Time) (domain.JWTDecoded, error) {
	parts := strings.Split(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(token), "Bearer ")), ".")
	if len(parts) != 3 {
		return domain.JWTDecoded{}, errors.New("a JWT has three dot-separated parts")
	}
	header, err := decodeSegment(parts[0], "header")
	if err != nil {
		return domain.JWTDecoded{}, err
	}
	body, err := decodeSegment(parts[1], "payload")
	if err != nil {
		return domain.JWTDecoded{}, err
	}
	var head struct {
		Alg string `json:"alg"`
	}
	_ = json.Unmarshal(header, &head)
	var claims struct {
		Iat            *float64 `json:"iat"`
		Exp            *float64 `json:"exp"`
		ResourceAccess struct {
			Roles []string `json:"roles"`
		} `json:"resource_access"`
	}
	_ = json.Unmarshal(body, &claims)

	out := domain.JWTDecoded{Header: pretty(header), Payload: pretty(body), Algorithm: head.Alg, Roles: claims.ResourceAccess.Roles}
	if out.Roles == nil {
		out.Roles = []string{}
	}
	if claims.Iat != nil {
		out.IssuedAt = time.Unix(int64(*claims.Iat), 0).UTC().Format(time.RFC3339)
	}
	if claims.Exp != nil {
		out.ExpiresAt = time.Unix(int64(*claims.Exp), 0).UTC().Format(time.RFC3339)
		out.Expired = now.Unix() >= int64(*claims.Exp)
	}
	out.Signature, out.SignatureError = verify(head.Alg, parts, settings)
	return out, nil
}

func verify(alg string, parts []string, settings domain.JWTSettings) (status, problem string) {
	signature, err := b64.DecodeString(strings.TrimRight(parts[2], "="))
	if err != nil {
		return "invalid", "signature is not base64url"
	}
	input := []byte(parts[0] + "." + parts[1])
	switch alg {
	case AlgHS256:
		if settings.Secret == "" {
			return "unverified", "no HS256 secret to verify with"
		}
		mac := hmac.New(sha256.New, []byte(settings.Secret))
		mac.Write(input)
		if hmac.Equal(mac.Sum(nil), signature) {
			return "valid", ""
		}
		return "invalid", "signature does not match the secret"
	case AlgRS256:
		key, err := verificationKey(settings)
		if err != nil {
			return "unverified", err.Error()
		}
		digest := sha256.Sum256(input)
		if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
			return "invalid", "signature does not match the public key"
		}
		return "valid", ""
	default:
		return "unverified", fmt.Sprintf("algorithm %q is not supported for verification", alg)
	}
}

// verificationKey prefers the public key and falls back to the private one.
func verificationKey(settings domain.JWTSettings) (*rsa.PublicKey, error) {
	if strings.TrimSpace(settings.PublicKey) != "" {
		return parsePublicKey(settings.PublicKey)
	}
	if strings.TrimSpace(settings.PrivateKey) != "" {
		key, err := parsePrivateKey(settings.PrivateKey)
		if err != nil {
			return nil, err
		}
		return &key.PublicKey, nil
	}
	return nil, errors.New("no RS256 key to verify with")
}

func decodeSegment(segment, name string) ([]byte, error) {
	data, err := b64.DecodeString(strings.TrimRight(segment, "="))
	if err != nil {
		return nil, fmt.Errorf("the %s is not base64url", name)
	}
	if !json.Valid(data) {
		return nil, fmt.Errorf("the %s is not JSON", name)
	}
	return data, nil
}

func pretty(data []byte) string {
	var out bytes.Buffer
	if err := json.Indent(&out, data, "", "  "); err != nil {
		return string(data)
	}
	return out.String()
}

// keyBlock accepts PEM text or base64-encoded PEM (as in a
// *_SECRET_IN_BASE64 env variable) and returns the DER bytes.
func keyBlock(text, what string) ([]byte, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, fmt.Errorf("the %s key is empty", what)
	}
	data := []byte(text)
	if !strings.Contains(text, "-----BEGIN") {
		decoded, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(text), ""))
		if err != nil {
			return nil, fmt.Errorf("the %s key is neither PEM nor base64-encoded PEM", what)
		}
		data = decoded
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("the %s key is not PEM", what)
	}
	return block.Bytes, nil
}

func parsePrivateKey(text string) (*rsa.PrivateKey, error) {
	der, err := keyBlock(text, "private")
	if err != nil {
		return nil, err
	}
	if key, err := x509.ParsePKCS1PrivateKey(der); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("the private key is not an RSA key")
	}
	return key, nil
}

func parsePublicKey(text string) (*rsa.PublicKey, error) {
	der, err := keyBlock(text, "public")
	if err != nil {
		return nil, err
	}
	if parsed, err := x509.ParsePKIXPublicKey(der); err == nil {
		if key, ok := parsed.(*rsa.PublicKey); ok {
			return key, nil
		}
		return nil, errors.New("the public key is not an RSA key")
	}
	if key, err := x509.ParsePKCS1PublicKey(der); err == nil {
		return key, nil
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, errors.New("parse public key: expected PKIX, PKCS#1 or a certificate")
	}
	key, ok := cert.PublicKey.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("the certificate does not hold an RSA key")
	}
	return key, nil
}
