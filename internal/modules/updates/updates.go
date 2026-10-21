// Package updates compares the running RepoDock with its releases on
// GitHub (ADR-0034). It makes one HTTPS request to the GitHub API, only
// when the user asks, and sends nothing about the workspace.
package updates

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/example/repodock/internal/domain"
)

// Repository is the GitHub repository releases come from.
const Repository = "petter-ka/repodock"

// downloadsMarker starts the download table the release workflow appends
// to every release's notes; the About page links to the release instead.
const downloadsMarker = "<!-- repodock-downloads -->"

const (
	maxReleases     = 20
	maxResponseSize = 4 << 20
	requestTimeout  = 15 * time.Second
)

type Checker struct {
	client  *http.Client
	api     string
	current string
	now     func() time.Time
}

// New checks the GitHub releases of Repository against current.
func New(current string) *Checker {
	return NewWith(current, "https://api.github.com/repos/"+Repository+"/releases", &http.Client{Timeout: requestTimeout})
}

// NewWith lets tests point the checker at another endpoint.
func NewWith(current, api string, client *http.Client) *Checker {
	return &Checker{client: client, api: api, current: current, now: time.Now}
}

type apiRelease struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Prerelease  bool      `json:"prerelease"`
	Draft       bool      `json:"draft"`
}

// Check fetches the recent releases and compares them with the running
// version.
func (c *Checker) Check(ctx context.Context) (domain.UpdateCheck, error) {
	result := domain.UpdateCheck{Current: c.current, Releases: []domain.Release{}}
	releases, err := c.fetch(ctx)
	if err != nil {
		return result, err
	}
	result.CheckedAt = c.now().UTC()
	current, comparable := parse(c.current)
	result.Comparable = comparable

	type ranked struct {
		release domain.Release
		version version
		valid   bool
	}
	var list []ranked
	for _, r := range releases {
		if r.Draft || r.TagName == "" {
			continue
		}
		v, ok := parse(r.TagName)
		release := domain.Release{
			Tag: r.TagName, Name: strings.TrimSpace(r.Name), URL: r.HTMLURL,
			Notes: notes(r.Body), PublishedAt: r.PublishedAt, Prerelease: r.Prerelease,
		}
		if release.Name == "" {
			release.Name = r.TagName
		}
		release.Newer = comparable && ok && v.compare(current) > 0
		list = append(list, ranked{release, v, ok})
	}
	// Newest first: by version where both have one, else by date.
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].valid && list[j].valid {
			return list[i].version.compare(list[j].version) > 0
		}
		return list[i].release.PublishedAt.After(list[j].release.PublishedAt)
	})
	for _, item := range list {
		result.Releases = append(result.Releases, item.release)
	}
	// The latest is the newest stable release; prereleases count only for
	// someone running one, or when nothing stable exists.
	for _, item := range list {
		if !item.release.Prerelease || current.pre != "" {
			result.Latest = item.release
			break
		}
	}
	if result.Latest.Tag == "" && len(list) > 0 {
		result.Latest = list[0].release
	}
	result.UpdateAvailable = result.Latest.Newer
	return result, nil
}

func (c *Checker) fetch(ctx context.Context) ([]apiRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.api+"?per_page="+strconv.Itoa(maxReleases), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "RepoDock/"+c.current)
	resp, err := c.client.Do(req)
	if err != nil {
		var timeout interface{ Timeout() bool }
		if errors.As(err, &timeout) && timeout.Timeout() {
			return nil, fmt.Errorf("GitHub did not answer in time")
		}
		return nil, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, fmt.Errorf("no releases found for %s", Repository)
	case (resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests) && resp.Header.Get("X-RateLimit-Remaining") == "0":
		return nil, fmt.Errorf("GitHub's rate limit for anonymous requests is reached; try again later")
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("GitHub answered %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize+1))
	if err != nil {
		return nil, fmt.Errorf("read GitHub's answer: %w", err)
	}
	if len(data) > maxResponseSize {
		return nil, fmt.Errorf("GitHub's answer is too large")
	}
	var releases []apiRelease
	if err := json.Unmarshal(data, &releases); err != nil {
		return nil, fmt.Errorf("unexpected answer from GitHub: %w", err)
	}
	return releases, nil
}

// notes drops the download table CI appends to the release notes.
func notes(body string) string {
	if i := strings.Index(body, downloadsMarker); i >= 0 {
		body = body[:i]
	}
	return strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
}

// version is a release tag: v1.2.3, 1.2, v1.2.3-beta.1.
type version struct {
	parts [3]int
	pre   string
}

func parse(tag string) (version, bool) {
	tag = strings.TrimPrefix(strings.TrimSpace(tag), "v")
	core, pre, _ := strings.Cut(tag, "-")
	core, _, _ = strings.Cut(core, "+")
	fields := strings.Split(core, ".")
	if len(fields) == 0 || len(fields) > 3 || fields[0] == "" {
		return version{}, false
	}
	var v version
	for i, field := range fields {
		n, err := strconv.Atoi(field)
		if err != nil || n < 0 {
			return version{}, false
		}
		v.parts[i] = n
	}
	v.pre = pre
	return v, true
}

// compare follows semver: a prerelease sorts before its release, and
// prerelease identifiers compare numerically when both are numbers.
func (v version) compare(o version) int {
	for i := range v.parts {
		if v.parts[i] != o.parts[i] {
			return v.parts[i] - o.parts[i]
		}
	}
	switch {
	case v.pre == o.pre:
		return 0
	case v.pre == "":
		return 1
	case o.pre == "":
		return -1
	}
	a, b := strings.Split(v.pre, "."), strings.Split(o.pre, ".")
	for i := 0; i < len(a) && i < len(b); i++ {
		x, errX := strconv.Atoi(a[i])
		y, errY := strconv.Atoi(b[i])
		switch {
		case errX == nil && errY == nil && x != y:
			return x - y
		case errX != nil || errY != nil:
			if c := strings.Compare(a[i], b[i]); c != 0 {
				return c
			}
		}
	}
	return len(a) - len(b)
}
