package handler

import (
	"net/http"

	internal "unknownaccessanalyze/internal/handler"
)

var h = internal.New()

func Handler(w http.ResponseWriter, r *http.Request) {
	h.ServeHTTP(w, r)
}
