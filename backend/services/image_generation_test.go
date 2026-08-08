package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGenerateAvatarSpriteReportsUnconfiguredNode(t *testing.T) {
	_, err := NewImageGenerator(ImageGenerationSettings{}).GenerateAvatarSprite(context.Background(), AvatarSpriteSpec{})
	if !errors.Is(err, ErrImageGenerationNotConfigured) {
		t.Fatalf("expected ErrImageGenerationNotConfigured, got %v", err)
	}
}

func TestAvatarSpritePromptIncludesGhibliLocationAndGuardrails(t *testing.T) {
	prompt := avatarSpritePrompt(AvatarSpriteSpec{
		Prompt:         "short black hair and red scarf",
		Gender:         "female",
		ReferenceImage: "data:image/png;base64,abc",
		CityName:       "杭州",
		ProvinceName:   "浙江",
		Landmark:       "西湖 / 雷峰塔",
	})

	for _, want := range []string{
		"Studio Ghibli-inspired hand-drawn traveler image",
		"watercolor-and-gouache texture",
		"soft cel-animation linework",
		"do not copy any existing Studio Ghibli film",
		"Local character details",
		"杭州, 浙江",
		"local landmark or atmosphere: 西湖 / 雷峰塔",
		"one polished square illustration",
		"lively walking pose",
		"complete traveler mid-step",
		"If the prompt asks for two people or a couple",
		"do not split them into panels",
		"Do not create a sprite sheet",
		"do not use transparent background",
		"high-resolution moving layer",
		"Negative prompt:",
		"chroma key",
		"frame boundary slicing",
		"hard pixel edges",
		"copied Studio Ghibli scene",
		"short black hair and red scarf",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("expected prompt to contain %q, got:\n%s", want, prompt)
		}
	}
}

func TestAvatarSpritePromptCanUseSettingsOnly(t *testing.T) {
	prompt := avatarSpritePrompt(AvatarSpriteSpec{
		Gender:       "male",
		CityName:     "徐州",
		ProvinceName: "江苏",
		Landmark:     "城市地标待添加",
	})

	for _, want := range []string{
		"cute young man",
		"friendly, warm, soft expression",
		"徐州, 江苏",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("expected settings-only prompt to contain %q, got:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "城市地标待添加") {
		t.Fatalf("expected placeholder landmark to be omitted, got:\n%s", prompt)
	}
}

func TestNormalizeImageGenerationNodesUsesV1BaseURLAndImageModel(t *testing.T) {
	nodes := normalizeImageGenerationNodes([]ImageGenerationNode{
		{
			Name:    "new api",
			BaseURL: "https://image-api.example.com/",
			APIKey:  "secret",
			Enabled: true,
		},
	}, nil)

	if len(nodes) != 1 {
		t.Fatalf("expected one normalized node, got %#v", nodes)
	}
	if nodes[0].BaseURL != "https://image-api.example.com/v1" {
		t.Fatalf("expected /v1 base url, got %q", nodes[0].BaseURL)
	}
	if nodes[0].Model != "gpt-image-2" {
		t.Fatalf("expected gpt-image-2 default model, got %q", nodes[0].Model)
	}
}

func TestNormalizePromptTemplateUpgradesPreviousStorybookDefault(t *testing.T) {
	prompt := normalizePromptTemplate(previousStorybookAvatarPromptTemplate)
	if !strings.Contains(prompt, "Studio Ghibli-inspired") {
		t.Fatalf("expected previous storybook prompt template to upgrade, got:\n%s", prompt)
	}
}

func TestNormalizePromptTemplateUpgradesPreviousPixelDefault(t *testing.T) {
	prompt := normalizePromptTemplate(previousPixelAvatarPromptTemplate)
	if !strings.Contains(prompt, "Studio Ghibli-inspired") {
		t.Fatalf("expected previous pixel prompt template to upgrade, got:\n%s", prompt)
	}
}

func TestNormalizePromptTemplateUpgradesLegacyDefault(t *testing.T) {
	prompt := normalizePromptTemplate(legacyDefaultAvatarPromptTemplate)
	if !strings.Contains(prompt, "Studio Ghibli-inspired") {
		t.Fatalf("expected legacy prompt template to upgrade, got:\n%s", prompt)
	}
}

func TestNormalizeNegativePromptUpgradesPreviousStorybookDefault(t *testing.T) {
	prompt := normalizeNegativePrompt(previousStorybookAvatarNegativePrompt)
	if !strings.Contains(prompt, "copied Studio Ghibli scene") {
		t.Fatalf("expected previous storybook negative prompt to upgrade, got:\n%s", prompt)
	}
}

func TestNormalizeNegativePromptUpgradesPreviousPixelDefault(t *testing.T) {
	prompt := normalizeNegativePrompt(previousPixelAvatarNegativePrompt)
	if !strings.Contains(prompt, "copied Studio Ghibli scene") {
		t.Fatalf("expected previous pixel negative prompt to upgrade, got:\n%s", prompt)
	}
}

func TestNormalizeNegativePromptUpgradesLegacyDefault(t *testing.T) {
	prompt := normalizeNegativePrompt(legacyDefaultAvatarNegativePrompt)
	if !strings.Contains(prompt, "copied Studio Ghibli scene") {
		t.Fatalf("expected legacy negative prompt to upgrade, got:\n%s", prompt)
	}
}

func TestCallImageGenerationUsesHighQualityForGPTImageModels(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"aW1hZ2U="}]}`))
	}))
	defer server.Close()

	generator := NewImageGenerator(ImageGenerationSettings{})
	_, err := generator.callImageGeneration(context.Background(), ImageGenerationNode{
		BaseURL: server.URL + "/v1",
		APIKey:  "secret",
		Model:   "gpt-image-2",
	}, "draw a traveler")
	if err != nil {
		t.Fatalf("callImageGeneration failed: %v", err)
	}

	for key, want := range map[string]string{
		"quality":       "high",
		"background":    "opaque",
		"output_format": "png",
		"size":          "1024x1024",
	} {
		if payload[key] != want {
			t.Fatalf("expected %s=%q, got %#v in %#v", key, want, payload[key], payload)
		}
	}
	if _, ok := payload["response_format"]; ok {
		t.Fatalf("gpt-image request should not use legacy response_format, got %#v", payload)
	}
}

func TestCallImageGenerationKeepsLegacyResponseFormatForOtherModels(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"aW1hZ2U="}]}`))
	}))
	defer server.Close()

	generator := NewImageGenerator(ImageGenerationSettings{})
	_, err := generator.callImageGeneration(context.Background(), ImageGenerationNode{
		BaseURL: server.URL,
		APIKey:  "secret",
		Model:   "dall-e-3",
	}, "draw a traveler")
	if err != nil {
		t.Fatalf("callImageGeneration failed: %v", err)
	}

	if payload["response_format"] != "b64_json" {
		t.Fatalf("expected legacy response_format, got %#v", payload)
	}
	if _, ok := payload["quality"]; ok {
		t.Fatalf("non-gpt-image request should not get gpt-image quality params, got %#v", payload)
	}
}
