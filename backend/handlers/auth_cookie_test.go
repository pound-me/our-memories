package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	_ "github.com/glebarez/sqlite"
	sqlitegorm "github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"our-memories-backend/config"
	"our-memories-backend/db"
	"our-memories-backend/dbschema"
	"our-memories-backend/middleware"
	"our-memories-backend/utils"
)

func setupAuthCookieTestDB(t *testing.T) {
	t.Helper()
	t.Setenv("JWT_SECRET", "test-secret-with-enough-length")
	t.Setenv("S3_PUBLIC_BASE_URL", "https://new-cdn.example.com")
	config.Load()

	name := strings.NewReplacer("/", "-", " ", "-", ":", "-").Replace(t.Name())
	testDB, err := sql.Open("sqlite", "file:"+name+"?mode=memory&cache=shared&_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = testDB.Close()
	})

	db.DB = testDB
	db.Gorm, err = gorm.Open(sqlitegorm.Dialector{Conn: testDB}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := dbschema.AutoMigrate(db.Gorm); err != nil {
		t.Fatal(err)
	}

	_, err = db.DB.Exec(`
		INSERT INTO spaces (id, space_code, password_hash, name) VALUES ('space-1', 'space-one', ?, 'Space One');
		INSERT INTO users (id, space_id, username, display_name, role) VALUES ('user-1', 'space-1', 'me', 'Me', 'owner');
	`, utils.HashPassword("correct-password"))
	if err != nil {
		t.Fatal(err)
	}
}

func TestLoginSetsHttpOnlyAuthCookies(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupAuthCookieTestDB(t)

	body := strings.NewReader(`{"spaceCode":"space-one","password":"correct-password","userId":"me"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request

	Login(c)

	if response.Code != http.StatusOK {
		t.Fatalf("expected login to pass, got %d: %s", response.Code, response.Body.String())
	}
	assertAuthCookie(t, response.Result().Cookies(), middleware.AccessTokenCookieName)
	assertAuthCookie(t, response.Result().Cookies(), middleware.RefreshTokenCookieName)

	var payload struct {
		Membership struct {
			Role string `json:"role"`
		} `json:"membership"`
		Space struct {
			Slug string `json:"slug"`
		} `json:"space"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Membership.Role != "owner" {
		t.Fatalf("expected owner membership, got %q", payload.Membership.Role)
	}
	if payload.Space.Slug != "space-one" {
		t.Fatalf("expected space slug fallback, got %q", payload.Space.Slug)
	}
}

func TestGetMeRestoresBrowserSessionMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupAuthCookieTestDB(t)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request
	c.Set("userID", "user-1")
	c.Set("spaceID", "space-1")

	GetMe(c)

	if response.Code != http.StatusOK {
		t.Fatalf("expected me to pass, got %d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		User struct {
			Username string `json:"username"`
		} `json:"user"`
		Membership struct {
			Role string `json:"role"`
		} `json:"membership"`
		Space struct {
			Slug string `json:"slug"`
		} `json:"space"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.User.Username != "me" || payload.Membership.Role != "owner" || payload.Space.Slug != "space-one" {
		t.Fatalf("unexpected session metadata: %#v", payload)
	}
}

func TestRefreshUsesRefreshCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET", "test-secret-with-enough-length")
	t.Setenv("S3_PUBLIC_BASE_URL", "https://new-cdn.example.com")
	config.Load()

	refreshToken, err := utils.GenerateRefreshToken("user-1", "space-1")
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	request.AddCookie(&http.Cookie{Name: middleware.RefreshTokenCookieName, Value: refreshToken})
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request

	Refresh(c)

	if response.Code != http.StatusOK {
		t.Fatalf("expected refresh to pass, got %d: %s", response.Code, response.Body.String())
	}
	assertAuthCookie(t, response.Result().Cookies(), middleware.AccessTokenCookieName)

	var payload struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.AccessToken == "" {
		t.Fatal("expected response body to retain accessToken for non-browser clients")
	}
}

func TestLogoutClearsAuthCookies(t *testing.T) {
	gin.SetMode(gin.TestMode)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request

	Logout(c)

	if response.Code != http.StatusOK {
		t.Fatalf("expected logout to pass, got %d: %s", response.Code, response.Body.String())
	}
	assertClearedAuthCookie(t, response.Result().Cookies(), middleware.AccessTokenCookieName)
	assertClearedAuthCookie(t, response.Result().Cookies(), middleware.RefreshTokenCookieName)
}

func assertAuthCookie(t *testing.T, cookies []*http.Cookie, name string) {
	t.Helper()
	for _, cookie := range cookies {
		if cookie.Name != name {
			continue
		}
		if !cookie.HttpOnly {
			t.Fatalf("%s should be HttpOnly", name)
		}
		if cookie.Value == "" {
			t.Fatalf("%s should have value", name)
		}
		if cookie.Path != "/" {
			t.Fatalf("%s should use root path, got %q", name, cookie.Path)
		}
		return
	}
	t.Fatalf("missing cookie %s", name)
}

func assertClearedAuthCookie(t *testing.T, cookies []*http.Cookie, name string) {
	t.Helper()
	for _, cookie := range cookies {
		if cookie.Name != name {
			continue
		}
		if !cookie.HttpOnly {
			t.Fatalf("%s should be HttpOnly", name)
		}
		if cookie.MaxAge >= 0 {
			t.Fatalf("%s should be expired, got maxAge %d", name, cookie.MaxAge)
		}
		return
	}
	t.Fatalf("missing cleared cookie %s", name)
}
