package repositories_test

import (
	"strings"
	"testing"
	"time"

	"our-memories-backend/db"
	"our-memories-backend/repositories"
)

func TestWhisperRepositoryWritesRealTimestamps(t *testing.T) {
	setupRepositoryTestDB(t)
	repo := repositories.NewWhisperRepository(db.Gorm)

	firstReply := &repositories.WhisperReplyRecord{
		ID:        "reply-1",
		WhisperID: "whisper-1",
		UserID:    "user-1",
		Content:   "first",
	}
	if err := repo.Create(repositories.WhisperRecord{
		ID:          "whisper-1",
		SpaceID:     "space-1",
		Title:       "hello",
		CreatedByID: "user-1",
	}, firstReply); err != nil {
		t.Fatal(err)
	}
	if err := repo.AddReply("space-1", repositories.WhisperReplyRecord{
		ID:        "reply-2",
		WhisperID: "whisper-1",
		UserID:    "user-1",
		Content:   "second",
	}); err != nil {
		t.Fatal(err)
	}

	whispers, err := repo.List("space-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(whispers) != 1 || len(whispers[0].Messages) != 2 {
		t.Fatalf("unexpected whisper result: %#v", whispers)
	}
	assertRealWhisperTimestamp(t, whispers[0].CreatedAt)
	assertRealWhisperTimestamp(t, whispers[0].UpdatedAt)
	for _, reply := range whispers[0].Messages {
		assertRealWhisperTimestamp(t, reply.CreatedAt)
	}
}

func assertRealWhisperTimestamp(t *testing.T, value string) {
	t.Helper()
	if strings.EqualFold(strings.TrimSpace(value), "CURRENT_TIMESTAMP") {
		t.Fatalf("expected a real timestamp, got %q", value)
	}
	if _, err := time.Parse("2006-01-02 15:04:05", value); err != nil {
		t.Fatalf("expected SQLite UTC timestamp, got %q: %v", value, err)
	}
}
