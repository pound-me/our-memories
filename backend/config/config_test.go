package config

import "testing"

func TestLoadReadsDefaultProfileNames(t *testing.T) {
	t.Setenv("JWT_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DEFAULT_SPACE_NAME", "Private Space")
	t.Setenv("DEFAULT_USER_ME_NAME", "Person A")
	t.Setenv("DEFAULT_USER_TA_NAME", "Person B")

	Load()
	loaded := Get()
	if loaded.DefaultSpaceName != "Private Space" || loaded.DefaultUserMeName != "Person A" || loaded.DefaultUserTaName != "Person B" {
		t.Fatalf("expected profile names from environment, got %#v", loaded)
	}
}

func TestValidateAllowsExplicitSecureConfig(t *testing.T) {
	cfg := secureTestConfig()
	cfg.AutoSeed = true
	cfg.DefaultPassword = "local-space-password"
	cfg.AdminUsername = "admin"
	cfg.AdminPassword = "strong-admin-password"

	if err := Validate(cfg); err != nil {
		t.Fatalf("expected secure config to pass, got %v", err)
	}
}

func TestValidateAllowsFourCharacterAutoSeedPassword(t *testing.T) {
	cfg := secureTestConfig()
	cfg.AutoSeed = true
	cfg.DefaultPassword = "1234"

	if err := Validate(cfg); err != nil {
		t.Fatalf("expected four-character seed password to pass, got %v", err)
	}
}

func TestValidateRejectsWeakAutoSeedPassword(t *testing.T) {
	cfg := secureTestConfig()
	cfg.AutoSeed = true
	cfg.DefaultPassword = "123"

	if err := Validate(cfg); err == nil {
		t.Fatal("expected weak seed password to fail")
	}
}

func TestValidateRejectsIncompleteAdminCredentials(t *testing.T) {
	cfg := secureTestConfig()
	cfg.AdminUsername = "admin"

	if err := Validate(cfg); err == nil {
		t.Fatal("expected incomplete admin credentials to fail")
	}
}

func TestValidateRejectsExampleAdminPassword(t *testing.T) {
	cfg := secureTestConfig()
	cfg.AdminUsername = "admin"
	cfg.AdminPassword = "admin123456"

	if err := Validate(cfg); err == nil {
		t.Fatal("expected example admin password to fail")
	}
}

func TestValidateRejectsWildcardAllowedOrigin(t *testing.T) {
	cfg := secureTestConfig()
	cfg.AllowedOrigins = []string{"http://localhost:3002", "*"}

	if err := Validate(cfg); err == nil {
		t.Fatal("expected wildcard allowed origin to fail")
	}
}

func secureTestConfig() *Config {
	return &Config{
		JWTSecret: "0123456789abcdef0123456789abcdef",
	}
}
