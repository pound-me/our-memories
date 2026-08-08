package services

import (
	"errors"

	"our-memories-backend/config"
	"our-memories-backend/models"
	"our-memories-backend/repositories"
	"our-memories-backend/utils"
)

var ErrInvalidCredentials = errors.New("invalid credentials")
var ErrInvalidPasswordLength = errors.New("invalid password length")
var ErrSpaceNotFound = errors.New("space not found")
var ErrAdminAlreadyExists = errors.New("admin already exists")

type LoginRequest struct {
	SpaceCode string `json:"spaceCode" binding:"required"`
	Password  string `json:"password" binding:"required"`
	UserID    string `json:"userId" binding:"required"`
}

type LoginResult struct {
	AccessToken  string
	RefreshToken string
	User         models.User
	Users        []models.User
	Space        models.Space
}

type AdminLoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type AdminLoginResult struct {
	Token string
	Admin models.Admin
}

type AccountService struct {
	repo *repositories.AccountRepository
}

func NewAccountService(repo *repositories.AccountRepository) *AccountService {
	return &AccountService{repo: repo}
}

func (s *AccountService) Login(req LoginRequest) (LoginResult, error) {
	space, err := s.repo.SpaceByCode(req.SpaceCode)
	if err != nil {
		if errors.Is(err, repositories.ErrAccountNotFound) {
			return LoginResult{}, ErrInvalidCredentials
		}
		return LoginResult{}, err
	}
	if !utils.VerifyPassword(space.PasswordHash, req.Password) {
		return LoginResult{}, ErrInvalidCredentials
	}

	user, err := s.repo.UserByUsername(space.ID, req.UserID)
	if err != nil {
		return LoginResult{}, err
	}
	users, err := s.repo.UsersForSpace(space.ID)
	if err != nil {
		return LoginResult{}, err
	}

	accessToken, err := utils.GenerateAccessToken(user.ID, space.ID)
	if err != nil {
		return LoginResult{}, err
	}
	refreshToken, err := utils.GenerateRefreshToken(user.ID, space.ID)
	if err != nil {
		return LoginResult{}, err
	}

	return LoginResult{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         user,
		Users:        users,
		Space:        space,
	}, nil
}

func (s *AccountService) Me(userID string, spaceID string) (models.User, models.Space, error) {
	user, err := s.repo.UserByID(userID)
	if err != nil {
		return models.User{}, models.Space{}, err
	}
	space, err := s.repo.SpaceByID(spaceID)
	if err != nil {
		if errors.Is(err, repositories.ErrAccountNotFound) {
			return models.User{}, models.Space{}, ErrSpaceNotFound
		}
		return models.User{}, models.Space{}, err
	}
	return user, space, nil
}

func (s *AccountService) UpdatePassword(spaceID string, newPassword string) error {
	if len(newPassword) < 8 || len(newPassword) > 128 {
		return ErrInvalidPasswordLength
	}
	return s.repo.UpdateSpacePassword(spaceID, utils.HashPassword(newPassword))
}

func (s *AccountService) AdminLogin(req AdminLoginRequest) (AdminLoginResult, error) {
	admin, err := s.repo.AdminByUsername(req.Username)
	if err != nil {
		if errors.Is(err, repositories.ErrAccountNotFound) {
			return AdminLoginResult{}, ErrInvalidCredentials
		}
		return AdminLoginResult{}, err
	}
	if !utils.VerifyPassword(admin.PasswordHash, req.Password) {
		return AdminLoginResult{}, ErrInvalidCredentials
	}
	token, err := utils.GenerateAdminToken(admin.ID)
	if err != nil {
		return AdminLoginResult{}, err
	}
	return AdminLoginResult{Token: token, Admin: admin}, nil
}

func (s *AccountService) EnsureDefaultSpace(spaceCode string, password string, name string) (bool, error) {
	count, err := s.repo.SpaceCount()
	if err != nil {
		return false, err
	}
	if count > 0 {
		return false, nil
	}

	spaceID := utils.NewID()
	userMeID := utils.NewID()
	userTaID := utils.NewID()
	cfg := config.Get()
	if name == "" {
		name = cfg.DefaultSpaceName
	}
	err = s.repo.CreateSpaceWithUsers(
		repositories.SpaceRecord{
			ID:           spaceID,
			SpaceCode:    spaceCode,
			PasswordHash: utils.HashPassword(password),
			Name:         name,
		},
		[]repositories.UserRecord{
			{ID: userMeID, SpaceID: spaceID, Username: "me", DisplayName: cfg.DefaultUserMeName},
			{ID: userTaID, SpaceID: spaceID, Username: "ta", DisplayName: cfg.DefaultUserTaName},
		},
	)
	return err == nil, err
}

func (s *AccountService) CreateAdmin(username string, password string, displayName string) (models.Admin, error) {
	if _, err := s.repo.AdminByUsername(username); err == nil {
		return models.Admin{}, ErrAdminAlreadyExists
	} else if !errors.Is(err, repositories.ErrAccountNotFound) {
		return models.Admin{}, err
	}

	admin := repositories.AdminRecord{
		ID:           utils.NewID(),
		Username:     username,
		PasswordHash: utils.HashPassword(password),
		DisplayName:  displayName,
	}
	if err := s.repo.CreateAdmin(admin); err != nil {
		return models.Admin{}, err
	}
	return models.Admin{
		ID:          admin.ID,
		Username:    admin.Username,
		DisplayName: admin.DisplayName,
	}, nil
}

func (s *AccountService) EnsureAdmin(username string, password string, displayName string) (bool, error) {
	if displayName == "" {
		displayName = username
	}
	created := false
	if _, err := s.repo.AdminByUsername(username); errors.Is(err, repositories.ErrAccountNotFound) {
		created = true
	} else if err != nil {
		return false, err
	}

	admin := repositories.AdminRecord{
		ID:           utils.NewID(),
		Username:     username,
		PasswordHash: utils.HashPassword(password),
		DisplayName:  displayName,
	}
	if err := s.repo.UpsertAdminByUsername(admin); err != nil {
		return false, err
	}
	return created, nil
}
