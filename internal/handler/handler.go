package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"time"
	"unicode/utf8"
)

const maxBodyBytes = 64 * 1024

type entry struct {
	Time          string              `json:"time"`
	Method        string              `json:"method"`
	Path          string              `json:"path"`
	RawQuery      string              `json:"raw_query,omitempty"`
	Proto         string              `json:"proto"`
	Host          string              `json:"host"`
	RemoteAddr    string              `json:"remote_addr"`
	TLS           bool                `json:"tls"`
	Headers       map[string][]string `json:"headers"`
	BodyLen       int                 `json:"body_len"`
	BodyTruncated bool                `json:"body_truncated,omitempty"`
	Body          string              `json:"body,omitempty"`
	BodyB64       string              `json:"body_b64,omitempty"`
}

func New() http.Handler {
	return http.HandlerFunc(serve)
}

func serve(w http.ResponseWriter, r *http.Request) {
	body, truncated := readBody(r)

	e := entry{
		Time:          time.Now().UTC().Format(time.RFC3339Nano),
		Method:        r.Method,
		Path:          r.URL.Path,
		RawQuery:      r.URL.RawQuery,
		Proto:         r.Proto,
		Host:          r.Host,
		RemoteAddr:    r.RemoteAddr,
		TLS:           r.TLS != nil,
		Headers:       r.Header,
		BodyLen:       len(body),
		BodyTruncated: truncated,
	}
	if len(body) > 0 {
		if utf8.Valid(body) {
			e.Body = string(body)
		} else {
			e.BodyB64 = base64.StdEncoding.EncodeToString(body)
		}
	}

	if b, err := json.Marshal(e); err == nil {
		os.Stdout.Write(b)
		os.Stdout.Write([]byte{'\n'})
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	io.WriteString(w, "404 not found\n")
}

func readBody(r *http.Request) ([]byte, bool) {
	if r.Body == nil {
		return nil, false
	}
	defer r.Body.Close()
	buf := &bytes.Buffer{}
	_, _ = io.Copy(buf, io.LimitReader(r.Body, maxBodyBytes+1))
	if buf.Len() > maxBodyBytes {
		return buf.Bytes()[:maxBodyBytes], true
	}
	return buf.Bytes(), false
}
