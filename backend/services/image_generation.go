package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"sort"
	"strings"
	"time"

	"our-memories-backend/utils"
)

const (
	imageGenerationGlobalSpaceID = "__global__"
	imageGenerationSettingsKey   = "imageGenerationNodes"
	maskedAPIKey                 = "********"
)

const defaultAvatarPromptTemplate = `Create one premium high-resolution Studio Ghibli-inspired hand-drawn traveler image for a couple memory map.
{reference}
Subject: {gender}, cute human traveler in a lively walking pose, original design, {prompt}.
Location inspiration: {location}
Style direction: Studio Ghibli-inspired warm hand-drawn animation look. Use rich watercolor-and-gouache texture, soft cel-animation linework, gentle natural daylight, airy backgrounds, rounded friendly proportions, earthy clothing colors, subtle wind-swept details, and a calm countryside-adventure mood. Keep it original: do not copy any existing Studio Ghibli film, character, mascot, logo, poster, shot composition, or exact costume.
Local character details: incorporate understated local features from the selected place: architecture silhouettes, climate, plants, street textures, regional color accents, travel-map icons, and small background props. Prefer everyday travel clothing with local color accents rather than stereotyped ceremonial outfits.
Pose: show the complete traveler mid-step with one foot forward, natural arm swing, balanced body, and readable walking action. Keep the pose energetic but stable for a moving map illustration.
Output format: one polished square illustration, not a cutout. The traveler should be the clear focal point and occupy about 55-70% of frame height. If the prompt asks for two people or a couple, keep both complete full bodies together inside the same canvas; do not split them into panels, do not place either person across a frame boundary, and do not crop heads, hands, feet, hair, clothing, or accessories. Do not create a sprite sheet, animation strip, multiple poses, panels, borders, or repeated frames.
Map integration: include a soft warm paper-map or travel-journal background with subtle paths, rivers, location sketches, postcards, or foliage. The image will be displayed as a high-resolution moving layer on top of the map, so preserve beautiful details while keeping the silhouette readable at 96-180 px wide.
Background: do not use transparent background, chroma key, green screen, flat color backdrop, sticker cutout, or isolated product-style background. Use a finished illustrated background that blends with a romantic memory map.
Quality constraints: the character must clearly look like a cute human with natural proportions. No text, watermark, logo, cropped limbs, extra characters, animal features, monster features, distorted face, broken hands, squashed body, stretched body, plastic toy look, hard pixel edges, low-resolution blur, compression artifacts, or mixed art styles.
Negative prompt: {negative}`

const defaultAvatarNegativePrompt = "transparent background, chroma key, green screen, flat color backdrop, sticker, cutout, isolated product image, sprite sheet, animation strip, multiple frames, multiple poses, split composition, separated panels, frame boundary slicing, cropped partner, cropped head, cropped hands, cropped feet, pixel art, hard pixel edges, 16-bit JRPG, 3D render, plastic toy, vector icon, photorealistic, low quality, malformed human, squashed body, stretched body, monster, animal ears, extra limbs, broken hands, cropped body, exact famous character, copyrighted character, exact Studio Ghibli character, copied Studio Ghibli scene, copied film still, trademark logo, text, watermark, logo, rain overlay, weather effects"

// Old built-in templates are kept only to upgrade saved admin settings.
const previousStorybookAvatarPromptTemplate = `Create one premium high-resolution hand-drawn traveler image for a couple memory map.
{reference}
Subject: {gender}, cute human traveler in a lively walking pose, original design, {prompt}.
Location inspiration: {location}
Style direction: premium warm hand-painted storybook animation. Use rich watercolor-and-gouache texture, clean cel-animation linework, gentle natural daylight, rounded friendly proportions, earthy clothing colors, subtle wind-swept details, and a calm countryside-adventure mood. Avoid copying any specific studio, artist, film, or existing character.
Pose: show the complete traveler mid-step with one foot forward, natural arm swing, balanced body, and readable walking action. Keep the pose energetic but stable for a moving map illustration.
Output format: one polished square illustration, not a cutout. The traveler should be the clear focal point and occupy about 55-70% of frame height. If the prompt asks for two people or a couple, keep both complete full bodies together inside the same canvas; do not split them into panels, do not place either person across a frame boundary, and do not crop heads, hands, feet, hair, clothing, or accessories. Do not create a sprite sheet, animation strip, multiple poses, panels, borders, or repeated frames.
Map integration: include a soft warm paper-map or travel-journal background with subtle paths, rivers, location sketches, postcards, or foliage. The image will be displayed as a high-resolution moving layer on top of the map, so preserve beautiful details while keeping the silhouette readable at 96-180 px wide.
Background: do not use transparent background, chroma key, green screen, flat color backdrop, sticker cutout, or isolated product-style background. Use a finished illustrated background that blends with a romantic memory map.
Quality constraints: the character must clearly look like a cute human with natural proportions. No text, watermark, logo, cropped limbs, extra characters, animal features, monster features, distorted face, broken hands, squashed body, stretched body, plastic toy look, hard pixel edges, low-resolution blur, compression artifacts, or mixed art styles.
Negative prompt: {negative}`

const previousStorybookAvatarNegativePrompt = "transparent background, chroma key, green screen, flat color backdrop, sticker, cutout, isolated product image, sprite sheet, animation strip, multiple frames, multiple poses, split composition, separated panels, frame boundary slicing, cropped partner, cropped head, cropped hands, cropped feet, pixel art, hard pixel edges, 16-bit JRPG, 3D render, plastic toy, vector icon, photorealistic, low quality, malformed human, squashed body, stretched body, monster, animal ears, extra limbs, broken hands, cropped body, exact famous character, copyrighted character, text, watermark, logo, rain overlay, weather effects"

const previousPixelAvatarPromptTemplate = `Create one premium single-frame avatar sprite for a couple memory map.
{reference}
Subject: {gender}, full-body chibi human in a lively walking pose, original design, {prompt}.
Pose: show the complete character mid-step with one foot forward, natural arm swing, balanced body, and readable full-body walking action. Keep the pose energetic but stable for a tiny map marker.
Output format: one complete full-body character centered in a square canvas. If the prompt asks for two people or a couple, keep both complete full bodies together inside the same canvas with generous padding; do not split them into panels, do not place either person across a frame boundary, and do not crop heads, hands, feet, hair, clothing, or accessories. Do not create a sprite sheet, animation strip, multiple poses, panels, borders, or repeated frames.
Pixel art requirements: crisp hand-placed pixel art, clear hard pixel edges, no blur, no anti-aliased soft brush look, no watercolor, no oil painting, no 3D render, no vector icon. Use clean 16-bit HD-2D JRPG sprite aesthetics with readable face, cute proportions, coherent human anatomy, strong silhouette, and polished tiny-map readability.
Resolution guidance: draw the character as a compact sprite occupying about 70% of frame height with generous transparent padding. Make details simple enough to remain clear when displayed at 32-48 px tall.
Background: transparent PNG if supported; otherwise perfectly flat solid #00ff00 chroma-key background. The background must be one uniform color with no shadow, gradient, floor, texture, or lighting variation. Do not use #00ff00 inside the character.
Quality constraints: the character must clearly look like a cute human with natural proportions. No text, watermark, logo, cropped limbs, extra characters, animal features, monster features, distorted face, broken hands, squashed body, stretched body, messy pixels, low-resolution blur, compression artifacts, or mixed art styles.
Negative prompt: {negative}`

const previousPixelAvatarNegativePrompt = "sprite sheet, animation strip, multiple frames, multiple poses, split composition, separated panels, frame boundary slicing, cropped partner, cropped head, cropped hands, cropped feet, blurry, soft edges, anti-aliased painting, watercolor, oil painting, 3D render, vector icon, sticker, photorealistic, low quality, malformed human, squashed body, stretched body, monster, animal ears, extra limbs, broken hands, cropped body, text, watermark, logo, shadowed background, gradient background, rain overlay, weather effects"

const legacyDefaultAvatarPromptTemplate = `Create one premium single-frame avatar sprite for a couple memory map.
{reference}
Subject: {gender}, full-body chibi human, original design, {prompt}.
Output format: one complete full-body character centered in a square canvas. Do not create a sprite sheet, animation strip, multiple poses, panels, borders, or repeated frames.
Pixel art requirements: crisp hand-placed pixel art, clear hard pixel edges, no blur, no anti-aliased soft brush look, no watercolor, no oil painting, no 3D render, no vector icon. Use clean 16-bit HD-2D JRPG sprite aesthetics with readable face, cute proportions, coherent human anatomy, strong silhouette, and polished tiny-map readability.
Resolution guidance: draw the character as a compact sprite occupying about 70% of frame height with generous transparent padding. Make details simple enough to remain clear when displayed at 32-48 px tall.
Background: transparent PNG if supported; otherwise perfectly flat solid #00ff00 chroma-key background. The background must be one uniform color with no shadow, gradient, floor, texture, or lighting variation. Do not use #00ff00 inside the character.
Quality constraints: the character must clearly look like a cute human with natural proportions. No text, watermark, logo, cropped limbs, extra characters, animal features, monster features, distorted face, broken hands, squashed body, stretched body, messy pixels, low-resolution blur, compression artifacts, or mixed art styles.
Negative prompt: {negative}`

const legacyDefaultAvatarNegativePrompt = "sprite sheet, animation strip, multiple frames, multiple poses, panel borders, blurry, soft edges, anti-aliased painting, watercolor, oil painting, 3D render, vector icon, sticker, photorealistic, low quality, malformed human, squashed body, stretched body, monster, animal ears, extra limbs, broken hands, cropped body, text, watermark, logo, shadowed background, gradient background, rain overlay, weather effects"

type ImageGenerationNode struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey,omitempty"`
	APIKeySet bool   `json:"apiKeySet,omitempty"`
	Model     string `json:"model"`
	Enabled   bool   `json:"enabled"`
	Priority  int    `json:"priority"`
}

type ImageGenerationSettings struct {
	Nodes                []ImageGenerationNode `json:"nodes"`
	AvatarPromptTemplate string                `json:"avatarPromptTemplate"`
	AvatarNegativePrompt string                `json:"avatarNegativePrompt"`
}

type AvatarSpriteSpec struct {
	Prompt               string
	ReferenceImage       string
	Gender               string
	DisplayName          string
	CityName             string
	ProvinceName         string
	Landmark             string
	AvatarPromptTemplate string
	AvatarNegativePrompt string
}

type ImageGenerationResult struct {
	DataURL string
	NodeID  string
}

type ImageGenerator struct {
	settings ImageGenerationSettings
	client   *http.Client
}

var ErrImageGenerationNotConfigured = errors.New("image generation node not configured")

func (s *SettingService) ImageGenerationSettings() (ImageGenerationSettings, error) {
	settings := ImageGenerationSettings{Nodes: []ImageGenerationNode{}}
	if err := s.repo.ReadJSON(imageGenerationGlobalSpaceID, imageGenerationSettingsKey, &settings); err != nil {
		return ImageGenerationSettings{}, err
	}
	settings.Nodes = normalizeImageGenerationNodes(settings.Nodes, nil)
	settings.AvatarPromptTemplate = normalizePromptTemplate(settings.AvatarPromptTemplate)
	settings.AvatarNegativePrompt = normalizeNegativePrompt(settings.AvatarNegativePrompt)
	return settings, nil
}

func (s *SettingService) PublicImageGenerationSettings() (ImageGenerationSettings, error) {
	settings, err := s.ImageGenerationSettings()
	if err != nil {
		return ImageGenerationSettings{}, err
	}
	return maskImageGenerationSettings(settings), nil
}

func (s *SettingService) UpdateImageGenerationSettings(next ImageGenerationSettings) (ImageGenerationSettings, error) {
	current, err := s.ImageGenerationSettings()
	if err != nil {
		return ImageGenerationSettings{}, err
	}
	normalized := ImageGenerationSettings{
		Nodes:                normalizeImageGenerationNodes(next.Nodes, current.Nodes),
		AvatarPromptTemplate: normalizePromptTemplate(next.AvatarPromptTemplate),
		AvatarNegativePrompt: normalizeNegativePrompt(next.AvatarNegativePrompt),
	}
	if err := s.repo.UpsertJSON(utils.NewID(), imageGenerationGlobalSpaceID, imageGenerationSettingsKey, normalized); err != nil {
		return ImageGenerationSettings{}, err
	}
	return maskImageGenerationSettings(normalized), nil
}

func NewImageGenerator(settings ImageGenerationSettings) *ImageGenerator {
	return &ImageGenerator{
		settings: settings,
		client: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

func (g *ImageGenerator) GenerateAvatarSprite(ctx context.Context, spec AvatarSpriteSpec) (ImageGenerationResult, error) {
	nodes := enabledImageGenerationNodes(g.settings.Nodes)
	if len(nodes) == 0 {
		return ImageGenerationResult{}, ErrImageGenerationNotConfigured
	}

	prompt := avatarSpritePrompt(AvatarSpriteSpec{
		Prompt:               spec.Prompt,
		ReferenceImage:       spec.ReferenceImage,
		Gender:               spec.Gender,
		DisplayName:          spec.DisplayName,
		CityName:             spec.CityName,
		ProvinceName:         spec.ProvinceName,
		Landmark:             spec.Landmark,
		AvatarPromptTemplate: g.settings.AvatarPromptTemplate,
		AvatarNegativePrompt: g.settings.AvatarNegativePrompt,
	})
	var errs []string
	for _, node := range nodes {
		if spec.ReferenceImage != "" {
			if dataURL, err := g.callImageEdit(ctx, node, prompt, spec.ReferenceImage); err == nil {
				return ImageGenerationResult{DataURL: dataURL, NodeID: node.ID}, nil
			} else {
				errs = append(errs, fmt.Sprintf("%s edit: %v", node.Name, err))
			}
		}
		if dataURL, err := g.callImageGeneration(ctx, node, prompt); err == nil {
			return ImageGenerationResult{DataURL: dataURL, NodeID: node.ID}, nil
		} else {
			errs = append(errs, fmt.Sprintf("%s generation: %v", node.Name, err))
		}
	}

	return ImageGenerationResult{}, fmt.Errorf("all image generation nodes failed: %s", strings.Join(errs, "; "))
}

func normalizeImageGenerationNodes(nodes []ImageGenerationNode, current []ImageGenerationNode) []ImageGenerationNode {
	currentByID := make(map[string]ImageGenerationNode, len(current))
	for _, node := range current {
		if node.ID != "" {
			currentByID[node.ID] = node
		}
	}

	normalized := make([]ImageGenerationNode, 0, len(nodes))
	for index, node := range nodes {
		id := strings.TrimSpace(node.ID)
		if id == "" {
			id = utils.NewID()
		}
		name := trimWithDefault(node.Name, fmt.Sprintf("生图节点 %d", index+1), 60)
		baseURL := normalizeImageGenerationBaseURL(node.BaseURL)
		model := trimWithDefault(node.Model, "gpt-image-2", 80)

		apiKey := strings.TrimSpace(node.APIKey)
		if apiKey == "" || apiKey == maskedAPIKey {
			apiKey = currentByID[id].APIKey
		}

		normalized = append(normalized, ImageGenerationNode{
			ID:        id,
			Name:      name,
			BaseURL:   baseURL,
			APIKey:    apiKey,
			APIKeySet: apiKey != "",
			Model:     model,
			Enabled:   node.Enabled,
			Priority:  node.Priority,
		})
	}

	sort.SliceStable(normalized, func(i, j int) bool {
		if normalized[i].Priority == normalized[j].Priority {
			return normalized[i].Name < normalized[j].Name
		}
		return normalized[i].Priority < normalized[j].Priority
	})
	return normalized
}

func normalizeImageGenerationBaseURL(value string) string {
	baseURL := strings.TrimRight(strings.TrimSpace(value), "/")
	if baseURL == "" {
		return ""
	}

	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return baseURL
	}
	if parsed.Path == "" || parsed.Path == "/" {
		parsed.Path = "/v1"
		parsed.RawPath = ""
		return strings.TrimRight(parsed.String(), "/")
	}
	return baseURL
}

func maskImageGenerationSettings(settings ImageGenerationSettings) ImageGenerationSettings {
	nodes := make([]ImageGenerationNode, len(settings.Nodes))
	for index, node := range settings.Nodes {
		nodes[index] = node
		nodes[index].APIKeySet = node.APIKey != ""
		nodes[index].APIKey = ""
	}
	return ImageGenerationSettings{
		Nodes:                nodes,
		AvatarPromptTemplate: settings.AvatarPromptTemplate,
		AvatarNegativePrompt: settings.AvatarNegativePrompt,
	}
}

func enabledImageGenerationNodes(nodes []ImageGenerationNode) []ImageGenerationNode {
	enabled := make([]ImageGenerationNode, 0, len(nodes))
	for _, node := range nodes {
		if node.Enabled && node.BaseURL != "" && node.APIKey != "" && node.Model != "" {
			enabled = append(enabled, node)
		}
	}
	sort.SliceStable(enabled, func(i, j int) bool {
		if enabled[i].Priority == enabled[j].Priority {
			return enabled[i].Name < enabled[j].Name
		}
		return enabled[i].Priority < enabled[j].Priority
	})
	return enabled
}

func trimWithDefault(value string, fallback string, maxLength int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = fallback
	}
	if len([]rune(value)) <= maxLength {
		return value
	}
	return string([]rune(value)[:maxLength])
}

func avatarSpritePrompt(spec AvatarSpriteSpec) string {
	genderHint := map[string]string{
		"female":  "cute young woman",
		"male":    "cute young man",
		"neutral": "cute human character",
	}[spec.Gender]
	if genderHint == "" {
		genderHint = "cute human character"
	}

	userPrompt := strings.TrimSpace(spec.Prompt)
	if userPrompt == "" {
		userPrompt = "friendly, warm, soft expression, suitable for a romantic memory map"
	}
	if len([]rune(userPrompt)) > 600 {
		userPrompt = string([]rune(userPrompt)[:600])
	}

	referenceHint := ""
	if spec.ReferenceImage != "" {
		referenceHint = "Use the uploaded reference photo only as appearance guidance while keeping the result an original hand-drawn animation illustration. "
	}

	template := normalizePromptTemplate("")
	negative := normalizeNegativePrompt("")
	if specTemplate := strings.TrimSpace(spec.AvatarPromptTemplate); specTemplate != "" {
		template = normalizePromptTemplate(specTemplate)
	}
	if specNegative := strings.TrimSpace(spec.AvatarNegativePrompt); specNegative != "" {
		negative = normalizeNegativePrompt(specNegative)
	}

	replacements := map[string]string{
		"{gender}":      genderHint,
		"{prompt}":      userPrompt,
		"{reference}":   referenceHint,
		"{displayName}": strings.TrimSpace(spec.DisplayName),
		"{location}":    locationInspiration(spec),
		"{negative}":    negative,
	}
	for placeholder, value := range replacements {
		template = strings.ReplaceAll(template, placeholder, value)
	}
	return template
}

func locationInspiration(spec AvatarSpriteSpec) string {
	cityName := trimPromptPart(spec.CityName, 40)
	provinceName := trimPromptPart(spec.ProvinceName, 40)
	landmark := trimPromptPart(spec.Landmark, 80)
	if landmark == "城市地标待添加" {
		landmark = ""
	}

	parts := []string{}
	if cityName != "" && provinceName != "" {
		parts = append(parts, fmt.Sprintf("%s, %s", cityName, provinceName))
	} else if cityName != "" {
		parts = append(parts, cityName)
	} else if provinceName != "" {
		parts = append(parts, provinceName)
	}
	if landmark != "" {
		parts = append(parts, "local landmark or atmosphere: "+landmark)
	}
	if len(parts) == 0 {
		return "use subtle local travel-map atmosphere based on the user's selected city when available, without adding text labels"
	}
	return strings.Join(parts, "; ") + ". Add subtle local architecture, climate, plants, colors, regional textures, street details, and travel-map motifs inspired by this place, without text labels or stereotyped costumes."
}

func trimPromptPart(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= maxLength {
		return value
	}
	return string([]rune(value)[:maxLength])
}

func normalizePromptTemplate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultAvatarPromptTemplate
	}
	if value == previousStorybookAvatarPromptTemplate {
		return defaultAvatarPromptTemplate
	}
	if value == previousPixelAvatarPromptTemplate {
		return defaultAvatarPromptTemplate
	}
	if value == legacyDefaultAvatarPromptTemplate {
		return defaultAvatarPromptTemplate
	}
	if len([]rune(value)) > 3000 {
		return string([]rune(value)[:3000])
	}
	return value
}

func normalizeNegativePrompt(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultAvatarNegativePrompt
	}
	if value == previousStorybookAvatarNegativePrompt {
		return defaultAvatarNegativePrompt
	}
	if value == previousPixelAvatarNegativePrompt {
		return defaultAvatarNegativePrompt
	}
	if value == legacyDefaultAvatarNegativePrompt {
		return defaultAvatarNegativePrompt
	}
	if len([]rune(value)) > 1200 {
		return string([]rune(value)[:1200])
	}
	return value
}

func (g *ImageGenerator) callImageGeneration(ctx context.Context, node ImageGenerationNode, prompt string) (string, error) {
	payload := map[string]any{
		"model":  node.Model,
		"prompt": prompt,
		"n":      1,
		"size":   "1024x1024",
	}
	if isGPTImageModel(node.Model) {
		payload["quality"] = "high"
		payload["background"] = "opaque"
		payload["output_format"] = "png"
	} else {
		payload["response_format"] = "b64_json"
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, node.BaseURL+"/images/generations", bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+node.APIKey)
	return g.decodeImageResponse(req)
}

func (g *ImageGenerator) callImageEdit(ctx context.Context, node ImageGenerationNode, prompt string, referenceImage string) (string, error) {
	imageBytes, mimeType, err := decodeDataURL(referenceImage)
	if err != nil {
		return "", err
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("model", node.Model)
	_ = writer.WriteField("prompt", prompt)
	_ = writer.WriteField("n", "1")
	_ = writer.WriteField("size", "1024x1024")
	if isGPTImageModel(node.Model) {
		_ = writer.WriteField("quality", "high")
		_ = writer.WriteField("background", "opaque")
		_ = writer.WriteField("output_format", "png")
	} else {
		_ = writer.WriteField("response_format", "b64_json")
	}

	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="image"; filename="reference.png"`)
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(imageBytes); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, node.BaseURL+"/images/edits", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+node.APIKey)
	return g.decodeImageResponse(req)
}

func isGPTImageModel(model string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "gpt-image")
}

func (g *ImageGenerator) decodeImageResponse(req *http.Request) (string, error) {
	resp, err := g.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("node returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var result struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if len(result.Data) == 0 {
		return "", errors.New("empty image response")
	}
	if result.Data[0].B64JSON != "" {
		return "data:image/png;base64," + result.Data[0].B64JSON, nil
	}
	if result.Data[0].URL != "" {
		return g.downloadImage(req.Context(), result.Data[0].URL)
	}
	return "", errors.New("image response has no image payload")
}

func (g *ImageGenerator) downloadImage(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := g.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("download returned %d", resp.StatusCode)
	}
	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		contentType = "image/png"
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", errors.New("downloaded image is empty")
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func decodeDataURL(dataURL string) ([]byte, string, error) {
	if !strings.HasPrefix(dataURL, "data:image/") {
		return nil, "", errors.New("reference image must be a data URL")
	}
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return nil, "", errors.New("invalid data URL")
	}
	mimeType := strings.TrimPrefix(strings.TrimSuffix(parts[0], ";base64"), "data:")
	data, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, "", err
	}
	if len(data) == 0 {
		return nil, "", errors.New("reference image is empty")
	}
	return data, mimeType, nil
}
