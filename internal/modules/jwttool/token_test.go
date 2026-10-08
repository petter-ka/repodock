//go:debug rsa1024min=0

package jwttool

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
)

func keyPair(t *testing.T, bits int) (private, public string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		t.Fatal(err)
	}
	pub, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	private = string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
	public = string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}))
	return private, public
}

func settings(private, public string) domain.JWTSettings {
	s := Defaults()
	s.ID, s.Email = "42", "dev@example.com"
	s.Roles = []string{"admin", "viewer", "editor"}
	s.SelectedRoles = []string{"editor", "admin"}
	s.PrivateKey, s.PublicKey = private, public
	return s
}

var now = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func TestGenerateAndDecodeRS256(t *testing.T) {
	private, public := keyPair(t, 2048)
	// The old script read keys as base64-encoded PEM; both forms work.
	s := settings(base64.StdEncoding.EncodeToString([]byte(private)), public)
	token, err := Generate(s, now)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(token.Payload), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["userName"] != "dev@example.com" || payload["realm"] != "customer-service" || payload["iss"] != "bms" {
		t.Fatalf("payload = %v", payload)
	}
	if roles := payload["resource_access"].(map[string]any)["roles"]; len(roles.([]any)) != 2 || roles.([]any)[0] != "admin" {
		t.Fatalf("selected roles must follow catalogue order, got %v", roles)
	}
	if token.ExpiresAt != "2026-10-15T12:00:00Z" {
		t.Fatalf("expiresAt = %s", token.ExpiresAt)
	}

	decoded, err := Decode("Bearer "+token.Token, s, now)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Signature != "valid" || decoded.Algorithm != "RS256" || decoded.Expired || strings.Join(decoded.Roles, ",") != "admin,editor" {
		t.Fatalf("decoded = %+v", decoded)
	}
	if expired, _ := Decode(token.Token, s, now.Add(8*24*time.Hour)); !expired.Expired {
		t.Fatal("expected expired")
	}

	// Without a public key the private key verifies; another key does not.
	s.PublicKey = ""
	if d, _ := Decode(token.Token, s, now); d.Signature != "valid" {
		t.Fatalf("private-key fallback: %+v", d)
	}
	_, otherPublic := keyPair(t, 2048)
	s.PublicKey = otherPublic
	if d, _ := Decode(token.Token, s, now); d.Signature != "invalid" {
		t.Fatalf("wrong key: %+v", d)
	}
	s.PrivateKey, s.PublicKey = "", ""
	if d, _ := Decode(token.Token, s, now); d.Signature != "unverified" {
		t.Fatalf("no key: %+v", d)
	}
}

func TestSmallKeysAreAllowedForTesting(t *testing.T) {
	// The old script used allowInsecureKeySizes; main.go sets rsa1024min=0.
	private, public := keyPair(t, 512)
	token, err := Generate(settings(private, public), now)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := Decode(token.Token, settings(private, public), now); d.Signature != "valid" {
		t.Fatalf("decoded = %+v", d)
	}
}

func TestHS256AndExtraClaims(t *testing.T) {
	s := settings("", "")
	s.Algorithm, s.Secret = AlgHS256, "shh"
	s.ExtraClaims = `{"tenant":"t1","channel":"web"}`
	token, err := Generate(s, now)
	if err != nil {
		t.Fatal(err)
	}
	d, err := Decode(token.Token, s, now)
	if err != nil || d.Signature != "valid" || !strings.Contains(d.Payload, `"tenant": "t1"`) || !strings.Contains(d.Payload, `"channel": "web"`) {
		t.Fatalf("decoded = %+v, %v", d, err)
	}
	s.Secret = "other"
	if d, _ := Decode(token.Token, s, now); d.Signature != "invalid" {
		t.Fatalf("wrong secret: %+v", d)
	}
}

func TestGenerateValidation(t *testing.T) {
	cases := map[string]func(*domain.JWTSettings){
		"ID is required":       func(s *domain.JWTSettings) { s.ID = " " },
		"email is required":    func(s *domain.JWTSettings) { s.Email = "" },
		"more than 0 days":     func(s *domain.JWTSettings) { s.ExpiresInDays = 0 },
		"JSON object":          func(s *domain.JWTSettings) { s.ExtraClaims = "[1]" },
		"private key is empty": func(s *domain.JWTSettings) {},
	}
	for want, mutate := range cases {
		s := settings("", "")
		mutate(&s)
		if _, err := Generate(s, now); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: err = %v", want, err)
		}
	}
}

func TestDecodeRejectsMalformedTokens(t *testing.T) {
	for _, token := range []string{"", "a.b", "!!.e30.x", "e30.bm90IGpzb24.x"} {
		if _, err := Decode(token, Defaults(), now); err == nil {
			t.Errorf("%q: expected error", token)
		}
	}
}

func TestSettingsPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jwt-tool.json")
	svc := New(path)
	if s, err := svc.Settings(); err != nil || s.Issuer != "bms" {
		t.Fatalf("defaults: %+v %v", s, err)
	}
	in := settings("key", "")
	in.Roles = []string{" admin ", "admin", "", "viewer"}
	in.SelectedRoles = []string{"viewer", "ghost"}
	saved, err := svc.Save(in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(saved.Roles, ",") != "admin,viewer" || strings.Join(saved.SelectedRoles, ",") != "viewer" {
		t.Fatalf("normalized = %v %v", saved.Roles, saved.SelectedRoles)
	}
	loaded, err := svc.Settings()
	if err != nil || loaded.Email != "dev@example.com" || loaded.PrivateKey != "key" {
		t.Fatalf("loaded = %+v %v", loaded, err)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("settings must be private, mode = %v", info.Mode().Perm())
	}
}
