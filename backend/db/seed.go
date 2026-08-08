package db

import (
	"log"

	"our-memories-backend/config"
	"our-memories-backend/repositories"
	"our-memories-backend/utils"
)

func Seed() {
	repo := repositories.NewAccountRepository(Gorm)
	count, err := repo.SpaceCount()
	if err != nil {
		log.Fatal("检查种子数据失败:", err)
	}
	if count > 0 {
		log.Println("数据库已存在数据，跳过种子数据")
		return
	}

	cfg := config.Get()
	spaceID := utils.NewID()
	passwordHash := utils.HashPassword(cfg.DefaultPassword)

	userMeID := utils.NewID()
	userTaID := utils.NewID()
	err = repo.CreateSpaceWithUsers(
		repositories.SpaceRecord{
			ID:           spaceID,
			SpaceCode:    cfg.DefaultSpaceCode,
			PasswordHash: passwordHash,
			Name:         cfg.DefaultSpaceName,
		},
		[]repositories.UserRecord{
			{ID: userMeID, SpaceID: spaceID, Username: "me", DisplayName: cfg.DefaultUserMeName},
			{ID: userTaID, SpaceID: spaceID, Username: "ta", DisplayName: cfg.DefaultUserTaName},
		},
	)
	if err != nil {
		log.Fatal("创建用户失败:", err)
	}

	log.Println("种子数据初始化完成")
}
