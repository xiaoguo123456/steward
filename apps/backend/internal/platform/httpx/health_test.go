package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRegisterHealthRoutesSupportsGetAndHead(t *testing.T) {
	router := chi.NewRouter()
	RegisterHealthRoutes(router, "/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	for _, method := range []string{http.MethodGet, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			request := httptest.NewRequest(method, "/healthz", nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusNoContent {
				t.Fatalf("%s /healthz 状态码 = %d，期望 %d",
					method, response.Code, http.StatusNoContent)
			}
		})
	}
}
