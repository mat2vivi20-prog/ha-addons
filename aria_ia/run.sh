#!/usr/bin/with-contenv bashio

bashio::log.info "Démarrage de ARIA v2.2 — Assistante IA Vitrolles (Gemini)..."

export GEMINI_API_KEY=$(bashio::config 'gemini_api_key')
export OLLAMA_URL=$(bashio::config 'ollama_url')
export OLLAMA_MODEL=$(bashio::config 'ollama_model')
export VIDEO_PATH=$(bashio::config 'video_path')
export PORT=$(bashio::addon.ingress_port)

if [ -n "$GEMINI_API_KEY" ]; then
    bashio::log.info "Backend : Gemini 2.0 Flash"
else
    bashio::log.info "Backend : Ollama (${OLLAMA_MODEL} @ ${OLLAMA_URL})"
fi

bashio::log.info "Vidéo   : ${VIDEO_PATH}"
bashio::log.info "Port    : ${PORT}"

node server.js
