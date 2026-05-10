# ARIA — Assistante IA pour Home Assistant

Assistante vocale en français pour ta maison. Contrôle tes appareils, surveille tes capteurs, et répond à tes questions via Gemini 2.0 Flash ou Ollama.

## Fonctionnalités

- Contrôle vocal de tous tes appareils (lumières, volets, prises, etc.)
- Événements temps réel via WebSocket
- Géolocalisation — sait qui est à la maison
- Alarme intégrée — armer/désarmer + alertes vocales
- Capteurs critiques (fumée, CO, gaz) — alerte immédiate
- Notifications mobiles
- Calendrier HA
- Planning hebdomadaire/mensuel
- Support Gemini 2.0 Flash et Ollama (local)

## Installation

1. Ajoute ce dépôt dans HA : `https://github.com/mat2vivi20/ha-addons`
2. Installe l'addon **ARIA — Assistante IA**
3. Configure ta clé API Gemini
4. Démarre

## Configuration

| Option | Description |
|--------|-------------|
| `gemini_api_key` | Clé API Google Gemini |
| `ollama_url` | URL Ollama (défaut : `http://host.docker.internal:11434`) |
| `ollama_model` | Modèle Ollama (défaut : `qwen2.5:7b`) |
| `video_path` | Chemin vers la vidéo ARIA |
| `log_level` | Niveau de log (`info`, `debug`, etc.) |
