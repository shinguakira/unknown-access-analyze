package main

import (
	"log"
	"net/http"
	"os"

	"unknownaccessanalyze/internal/handler"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler.New()); err != nil {
		log.Fatal(err)
	}
}
