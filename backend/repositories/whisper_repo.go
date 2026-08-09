package repositories

import (
	"database/sql"
	"errors"
	"time"

	"gorm.io/gorm"
	"our-memories-backend/models"
)

var ErrWhisperNotFound = sql.ErrNoRows

type WhisperRecord struct {
	ID          string               `gorm:"column:id;primaryKey"`
	SpaceID     string               `gorm:"column:space_id"`
	Title       string               `gorm:"column:title"`
	CreatedByID string               `gorm:"column:created_by_id"`
	CreatedAt   string               `gorm:"column:created_at"`
	UpdatedAt   string               `gorm:"column:updated_at"`
	Replies     []WhisperReplyRecord `gorm:"foreignKey:WhisperID;references:ID"`
}

func (WhisperRecord) TableName() string {
	return "whispers"
}

type WhisperReplyRecord struct {
	ID        string `gorm:"column:id;primaryKey"`
	WhisperID string `gorm:"column:whisper_id"`
	UserID    string `gorm:"column:user_id"`
	Content   string `gorm:"column:content"`
	VoiceURL  string `gorm:"column:voice_url"`
	CreatedAt string `gorm:"column:created_at"`
}

func (WhisperReplyRecord) TableName() string {
	return "whisper_replies"
}

type WhisperRepository struct {
	db *gorm.DB
}

func NewWhisperRepository(db *gorm.DB) *WhisperRepository {
	return &WhisperRepository{db: db}
}

func (r *WhisperRepository) List(spaceID string) ([]models.Whisper, error) {
	var records []WhisperRecord
	if err := r.db.
		Preload("Replies", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at")
		}).
		Where("space_id = ?", spaceID).
		Order("updated_at DESC").
		Find(&records).
		Error; err != nil {
		return nil, err
	}

	whispers := make([]models.Whisper, 0, len(records))
	for _, record := range records {
		messages := make([]models.WhisperReply, 0, len(record.Replies))
		for _, reply := range record.Replies {
			messages = append(messages, models.WhisperReply{
				ID:        reply.ID,
				WhisperID: reply.WhisperID,
				UserID:    reply.UserID,
				Content:   reply.Content,
				VoiceURL:  reply.VoiceURL,
				CreatedAt: reply.CreatedAt,
			})
		}
		whispers = append(whispers, models.Whisper{
			ID:          record.ID,
			SpaceID:     record.SpaceID,
			Title:       record.Title,
			CreatedByID: record.CreatedByID,
			CreatedAt:   record.CreatedAt,
			UpdatedAt:   record.UpdatedAt,
			Messages:    messages,
		})
	}
	return whispers, nil
}

func (r *WhisperRepository) CreatedByID(whisperID string, spaceID string) (string, error) {
	var record WhisperRecord
	err := r.db.
		Select("created_by_id").
		Where("id = ? AND space_id = ?", whisperID, spaceID).
		First(&record).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrWhisperNotFound
	}
	return record.CreatedByID, err
}

func (r *WhisperRepository) Create(whisper WhisperRecord, firstReply *WhisperReplyRecord) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		now := whisperTimestamp()
		if whisper.CreatedAt == "" {
			whisper.CreatedAt = now
		}
		if whisper.UpdatedAt == "" {
			whisper.UpdatedAt = now
		}
		if err := tx.Create(&whisper).Error; err != nil {
			return err
		}
		if firstReply == nil {
			return nil
		}
		if firstReply.CreatedAt == "" {
			firstReply.CreatedAt = now
		}
		return tx.Create(firstReply).Error
	})
}

func (r *WhisperRepository) AddReply(spaceID string, reply WhisperReplyRecord) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var whisper WhisperRecord
		err := tx.Select("id").
			Where("id = ? AND space_id = ?", reply.WhisperID, spaceID).
			First(&whisper).
			Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrWhisperNotFound
		}
		if err != nil {
			return err
		}
		now := whisperTimestamp()
		if reply.CreatedAt == "" {
			reply.CreatedAt = now
		}
		if err := tx.Create(&reply).Error; err != nil {
			return err
		}
		return tx.Model(&WhisperRecord{}).
			Where("id = ? AND space_id = ?", reply.WhisperID, spaceID).
			Update("updated_at", now).
			Error
	})
}

func whisperTimestamp() string {
	return time.Now().UTC().Format("2006-01-02 15:04:05")
}

func (r *WhisperRepository) Delete(whisperID string, spaceID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var whisper WhisperRecord
		err := tx.Select("id").
			Where("id = ? AND space_id = ?", whisperID, spaceID).
			First(&whisper).
			Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrWhisperNotFound
		}
		if err != nil {
			return err
		}
		if err := tx.Where("whisper_id = ?", whisperID).Delete(&WhisperReplyRecord{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND space_id = ?", whisperID, spaceID).Delete(&WhisperRecord{}).Error
	})
}
