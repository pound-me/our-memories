package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"our-memories-backend/db"
	"our-memories-backend/middleware"
	"our-memories-backend/repositories"
	"our-memories-backend/services"
	"our-memories-backend/utils"
)

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
}

func Login(c *gin.Context) {
	var req services.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Error(c, 400, "Invalid request")
		return
	}

	result, err := accountService().Login(req)
	if err != nil {
		writeLoginError(c, err)
		return
	}

	setAuthCookies(c, result.AccessToken, result.RefreshToken)
	users := make([]gin.H, 0, len(result.Users))
	for _, user := range result.Users {
		users = append(users, gin.H{
			"username":    user.Username,
			"displayName": user.DisplayName,
		})
	}
	utils.Success(c, gin.H{
		"accessToken":  result.AccessToken,
		"refreshToken": result.RefreshToken,
		"user": gin.H{
			"id":          result.User.ID,
			"username":    result.User.Username,
			"displayName": result.User.DisplayName,
		},
		"space": gin.H{
			"id":        result.Space.ID,
			"name":      result.Space.Name,
			"spaceCode": result.Space.SpaceCode,
			"slug":      result.Space.SpaceCode,
		},
		"membership": gin.H{"role": result.User.Role},
		"users": users,
	})
}

func Refresh(c *gin.Context) {
	refreshToken := ""
	if c.Request.Body != nil {
		body, _ := io.ReadAll(c.Request.Body)
		if len(strings.TrimSpace(string(body))) > 0 {
			var req RefreshRequest
			if err := json.Unmarshal(body, &req); err == nil {
				refreshToken = strings.TrimSpace(req.RefreshToken)
			}
		}
	}
	if refreshToken == "" {
		refreshToken, _ = c.Cookie(middleware.RefreshTokenCookieName)
	}
	if refreshToken == "" {
		utils.Error(c, 400, "Invalid request")
		return
	}

	claims, err := utils.VerifyToken(refreshToken)
	if err != nil {
		utils.Error(c, 401, "Invalid refresh token")
		return
	}

	accessToken, _ := utils.GenerateAccessToken(claims.UserID, claims.SpaceID)
	setAccessCookie(c, accessToken)

	utils.Success(c, gin.H{
		"accessToken": accessToken,
	})
}

func Logout(c *gin.Context) {
	clearAuthCookie(c, middleware.AccessTokenCookieName)
	clearAuthCookie(c, middleware.RefreshTokenCookieName)
	utils.Success(c, gin.H{"ok": true})
}

func setAuthCookies(c *gin.Context, accessToken string, refreshToken string) {
	setAccessCookie(c, accessToken)
	setAuthCookie(c, middleware.RefreshTokenCookieName, refreshToken, int((30 * 24 * 60 * 60)))
}

func setAccessCookie(c *gin.Context, accessToken string) {
	setAuthCookie(c, middleware.AccessTokenCookieName, accessToken, 30*60)
}

func setAuthCookie(c *gin.Context, name string, value string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   isSecureRequest(c),
		SameSite: http.SameSiteLaxMode,
	})
}

func clearAuthCookie(c *gin.Context, name string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isSecureRequest(c),
		SameSite: http.SameSiteLaxMode,
	})
}

func isSecureRequest(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	return strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
}

func GetMe(c *gin.Context) {
	userID := c.GetString("userID")
	spaceID := c.GetString("spaceID")

	user, space, err := accountService().Me(userID, spaceID)
	if err != nil {
		writeAccountServiceError(c, err, "Failed to fetch account")
		return
	}

	utils.Success(c, gin.H{
		"user": gin.H{
			"id":          user.ID,
			"username":    user.Username,
			"displayName": user.DisplayName,
		},
		"space": gin.H{
			"id":        space.ID,
			"name":      space.Name,
			"spaceCode": space.SpaceCode,
			"slug":      space.SpaceCode,
		},
		"membership": gin.H{"role": user.Role},
	})
}

func UpdatePassword(c *gin.Context) {
	spaceID := c.GetString("spaceID")

	var req struct {
		NewPassword string `json:"newPassword" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Error(c, 400, "Invalid request")
		return
	}

	if err := accountService().UpdatePassword(spaceID, req.NewPassword); err != nil {
		writeAccountServiceError(c, err, "Failed to update password")
		return
	}

	utils.Success(c, gin.H{"ok": true})
}

func accountService() *services.AccountService {
	return services.NewAccountService(repositories.NewAccountRepository(db.Gorm))
}

func writeLoginError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, services.ErrInvalidCredentials):
		utils.Error(c, 401, "Invalid space code or password")
	case errors.Is(err, repositories.ErrAccountNotFound):
		utils.Error(c, 404, "User not found")
	default:
		utils.Error(c, 500, "Failed to login")
	}
}

func writeAccountServiceError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, repositories.ErrAccountNotFound):
		utils.Error(c, 404, "User not found")
	case errors.Is(err, services.ErrSpaceNotFound):
		utils.Error(c, 404, "Space not found")
	case errors.Is(err, services.ErrInvalidPasswordLength):
		utils.Error(c, 400, "Password length must be 8-128")
	default:
		utils.Error(c, 500, fallback)
	}
}
