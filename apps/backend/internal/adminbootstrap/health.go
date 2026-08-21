package adminbootstrap

import (
	"encoding/json"
	"net/http"
)

func (a *App) healthHandler(w http.ResponseWriter, r *http.Request) {
	dbOK := a.DB.Healthy(r.Context())
	status := "ok"
	database := "ok"
	if !dbOK {
		status = "degraded"
		database = "error"
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if !dbOK {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":   status,
		"database": database,
	})
}
