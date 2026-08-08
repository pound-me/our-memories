package handlers

import (
	"errors"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"our-memories-backend/events"
	"our-memories-backend/services"
	"our-memories-backend/storage"
	"our-memories-backend/utils"
)

const maxAvatarSpriteHistory = 5

type avatarSpriteHistoryItem struct {
	URL         string `json:"url"`
	Key         string `json:"key,omitempty"`
	Prompt      string `json:"prompt,omitempty"`
	GeneratedAt string `json:"generatedAt"`
	NodeID      string `json:"nodeId,omitempty"`
}

type memberProfileForAvatar struct {
	Name                 string                    `json:"name,omitempty"`
	Gender               string                    `json:"gender,omitempty"`
	CityID               string                    `json:"cityId,omitempty"`
	AvatarSprite         string                    `json:"avatarSprite,omitempty"`
	AvatarSpriteFallback string                    `json:"avatarSpriteFallback,omitempty"`
	AvatarSpriteFrames   int                       `json:"avatarSpriteFrames,omitempty"`
	AvatarPrompt         string                    `json:"avatarPrompt,omitempty"`
	AvatarSpriteHistory  []avatarSpriteHistoryItem `json:"avatarSpriteHistory,omitempty"`
}

func GetImageGenerationSettings(c *gin.Context) {
	settings, err := settingService().PublicImageGenerationSettings()
	if err != nil {
		utils.Error(c, 500, "Failed to fetch image generation settings")
		return
	}
	utils.Success(c, settings)
}

func UpdateImageGenerationSettings(c *gin.Context) {
	var req services.ImageGenerationSettings
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Error(c, 400, "Invalid request")
		return
	}
	settings, err := settingService().UpdateImageGenerationSettings(req)
	if err != nil {
		utils.Error(c, 500, "Failed to update image generation settings")
		return
	}
	utils.Success(c, settings)
}

func GenerateAvatarSprite(c *gin.Context) {
	spaceID := c.GetString("spaceID")
	userID := c.GetString("userID")

	var req struct {
		Prompt         string `json:"prompt"`
		ReferenceImage string `json:"referenceImage"`
		Gender         string `json:"gender"`
		DisplayName    string `json:"displayName"`
		CityID         string `json:"cityId"`
		CityName       string `json:"cityName"`
		ProvinceName   string `json:"provinceName"`
		Landmark       string `json:"landmark"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Error(c, 400, "Invalid request")
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	req.Gender = trimAvatarRequestField(req.Gender, 20)
	req.DisplayName = trimAvatarRequestField(req.DisplayName, 40)
	req.CityID = trimAvatarRequestField(req.CityID, 80)
	req.CityName = trimAvatarRequestField(req.CityName, 80)
	req.ProvinceName = trimAvatarRequestField(req.ProvinceName, 80)
	req.Landmark = trimAvatarRequestField(req.Landmark, 120)

	settingSvc := settingService()
	imageSettings, err := settingSvc.ImageGenerationSettings()
	if err != nil {
		utils.Error(c, 500, "Failed to read image generation settings")
		return
	}

	result, err := services.NewImageGenerator(imageSettings).GenerateAvatarSprite(c.Request.Context(), services.AvatarSpriteSpec{
		Prompt:         req.Prompt,
		ReferenceImage: req.ReferenceImage,
		Gender:         req.Gender,
		DisplayName:    req.DisplayName,
		CityName:       req.CityName,
		ProvinceName:   req.ProvinceName,
		Landmark:       req.Landmark,
	})
	if err != nil {
		log.Printf("avatar sprite generation failed: %v", err)
		if errors.Is(err, services.ErrImageGenerationNotConfigured) {
			utils.Error(c, 503, "Image generation is not configured")
			return
		}
		utils.Error(c, 503, "Image generation service is unavailable")
		return
	}

	url, key, err := storage.Default().UploadImageWithKey(spaceID, "settings", result.DataURL)
	if err != nil {
		log.Printf("avatar sprite upload failed: %v", err)
		utils.Error(c, 500, "Avatar upload failed")
		return
	}

	profiles := map[string]memberProfileForAvatar{}
	_ = settingSvc.ReadJSON(spaceID, "memberProfiles", &profiles)
	profile := profiles[userID]
	if profile.Name == "" {
		profile.Name = strings.TrimSpace(req.DisplayName)
	}
	if req.Gender != "" {
		profile.Gender = req.Gender
	}
	if req.CityID != "" {
		profile.CityID = req.CityID
	}
	profile.AvatarSprite = url
	profile.AvatarSpriteFrames = 1
	profile.AvatarPrompt = req.Prompt
	profile.AvatarSpriteHistory = appendAvatarSpriteHistory(profile.AvatarSpriteHistory, avatarSpriteHistoryItem{
		URL:         url,
		Key:         key,
		Prompt:      req.Prompt,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		NodeID:      result.NodeID,
	})
	profiles[userID] = profile

	if err := settingSvc.Upsert(spaceID, "memberProfiles", profiles); err != nil {
		utils.Error(c, 500, "Failed to save avatar setting")
		return
	}

	_ = domainPublisher.Publish(c.Request.Context(), events.DomainEvent{
		Type:       events.AvatarGenerated,
		SpaceID:    spaceID,
		ActorID:    userID,
		TargetID:   userID,
		OccurredAt: time.Now().UTC(),
		Metadata: map[string]any{
			"avatarSprite": url,
			"key":          key,
			"nodeId":       result.NodeID,
		},
	})

	utils.Success(c, gin.H{
		"profile": profiles[userID],
		"url":     url,
		"key":     key,
	})
}

func trimAvatarRequestField(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= maxLength {
		return value
	}
	return string([]rune(value)[:maxLength])
}

func appendAvatarSpriteHistory(history []avatarSpriteHistoryItem, item avatarSpriteHistoryItem) []avatarSpriteHistoryItem {
	next := make([]avatarSpriteHistoryItem, 0, len(history)+1)
	seen := map[string]bool{}
	for _, existing := range history {
		if strings.TrimSpace(existing.URL) == "" || seen[existing.URL] {
			continue
		}
		seen[existing.URL] = true
		next = append(next, existing)
	}
	if item.URL != "" && !seen[item.URL] {
		next = append(next, item)
	}

	if len(next) <= maxAvatarSpriteHistory {
		return next
	}

	overflow := next[:len(next)-maxAvatarSpriteHistory]
	for _, stale := range overflow {
		if err := storage.Default().DeletePhotoObject(stale.Key, stale.URL); err != nil {
			log.Printf("delete stale avatar sprite failed (url=%s key=%s): %v", stale.URL, stale.Key, err)
		}
	}
	return next[len(next)-maxAvatarSpriteHistory:]
}
