package updates

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const sample = `[
  {"tag_name": "v0.4.0-beta.1", "name": "", "body": "beta", "html_url": "https://github.com/x/r/releases/tag/v0.4.0-beta.1", "published_at": "2026-10-20T10:00:00Z", "prerelease": true},
  {"tag_name": "v0.3.0", "name": "Node versions", "body": "## What's new\r\n- Node.js versions\n\n<!-- repodock-downloads -->\n## Downloads\n| a | b |", "html_url": "https://github.com/x/r/releases/tag/v0.3.0", "published_at": "2026-10-19T10:00:00Z"},
  {"tag_name": "v0.10.0-draft", "name": "draft", "draft": true},
  {"tag_name": "v0.2.0", "name": "v0.2.0", "body": "older", "html_url": "https://github.com/x/r/releases/tag/v0.2.0", "published_at": "2026-10-01T10:00:00Z"}
]`

func serve(t *testing.T, status int, body string, headers map[string]string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("User-Agent"), "RepoDock/") || r.URL.Query().Get("per_page") == "" {
			t.Errorf("unexpected request: %v %v", r.Header, r.URL)
		}
		for k, v := range headers {
			w.Header().Set(k, v)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server
}

func TestCheckFindsNewerStableRelease(t *testing.T) {
	server := serve(t, http.StatusOK, sample, nil)
	got, err := NewWith("v0.2.0", server.URL, server.Client()).Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !got.Comparable || !got.UpdateAvailable || got.Latest.Tag != "v0.3.0" || got.Latest.Name != "Node versions" {
		t.Fatalf("check = %+v", got)
	}
	if got.Latest.Notes != "## What's new\n- Node.js versions" {
		t.Fatalf("notes = %q", got.Latest.Notes)
	}
	tags := []string{}
	for _, r := range got.Releases {
		tags = append(tags, r.Tag)
	}
	if strings.Join(tags, ",") != "v0.4.0-beta.1,v0.3.0,v0.2.0" {
		t.Fatalf("releases = %v", tags)
	}
	if !got.Releases[0].Newer || !got.Releases[1].Newer || got.Releases[2].Newer || got.Releases[0].Name != "v0.4.0-beta.1" {
		t.Fatalf("newer flags = %+v", got.Releases)
	}
}

func TestCheckUpToDateAndDevBuilds(t *testing.T) {
	server := serve(t, http.StatusOK, sample, nil)
	current, err := NewWith("v0.3.0", server.URL, server.Client()).Check(context.Background())
	if err != nil || current.UpdateAvailable || current.Latest.Tag != "v0.3.0" {
		t.Fatalf("up to date: %+v, %v", current, err)
	}
	// Someone on a prerelease is offered prereleases.
	beta, _ := NewWith("v0.3.1-beta.1", server.URL, server.Client()).Check(context.Background())
	if beta.Latest.Tag != "v0.4.0-beta.1" || !beta.UpdateAvailable {
		t.Fatalf("beta: %+v", beta)
	}
	dev, _ := NewWith("dev", server.URL, server.Client()).Check(context.Background())
	if dev.Comparable || dev.UpdateAvailable || dev.Latest.Tag != "v0.3.0" {
		t.Fatalf("dev: %+v", dev)
	}
}

func TestCheckReportsGitHubErrors(t *testing.T) {
	limited := serve(t, http.StatusForbidden, `{}`, map[string]string{"X-RateLimit-Remaining": "0"})
	if _, err := NewWith("v1.0.0", limited.URL, limited.Client()).Check(context.Background()); err == nil || !strings.Contains(err.Error(), "rate limit") {
		t.Fatalf("err = %v", err)
	}
	broken := serve(t, http.StatusOK, `not json`, nil)
	if _, err := NewWith("v1.0.0", broken.URL, broken.Client()).Check(context.Background()); err == nil {
		t.Fatal("invalid JSON must fail")
	}
}

func TestCompareVersions(t *testing.T) {
	order := []string{"0.9.0", "v1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0", "1.0.1", "1.1"}
	for i := 1; i < len(order); i++ {
		a, okA := parse(order[i-1])
		b, okB := parse(order[i])
		if !okA || !okB || a.compare(b) >= 0 {
			t.Fatalf("%s should sort before %s", order[i-1], order[i])
		}
	}
	for _, bad := range []string{"dev", "", "dev-abc1234", "v1.x"} {
		if _, ok := parse(bad); ok {
			t.Fatalf("%q should not parse", bad)
		}
	}
}
