package app

import (
	"time"

	"github.com/example/repodock/internal/domain"
	jwtmod "github.com/example/repodock/internal/modules/jwttool"
)

// JWTSettings returns the JWT tool's remembered input (ADR-0020).
func (a *App) JWTSettings() (domain.JWTSettings, error) { return a.jwt.Settings() }

// SaveJWTSettings remembers the JWT tool's input, keys included, in a
// private local file.
func (a *App) SaveJWTSettings(settings domain.JWTSettings) (domain.JWTSettings, error) {
	return a.jwt.Save(settings)
}

// GenerateJWT signs a test token from the given settings.
func (a *App) GenerateJWT(settings domain.JWTSettings) (domain.JWTToken, error) {
	return jwtmod.Generate(settings, time.Now())
}

// DecodeJWT parses a token and verifies it with the keys in settings.
func (a *App) DecodeJWT(token string, settings domain.JWTSettings) (domain.JWTDecoded, error) {
	return jwtmod.Decode(token, settings, time.Now())
}
