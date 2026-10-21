package nodeversion

import (
	"fmt"
	"strconv"
	"strings"
)

// Version is a Node.js release version.
type Version struct{ Major, Minor, Patch int }

func (v Version) String() string { return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch) }

// Compare returns <0, 0 or >0 when v is lower than, equal to or higher than o.
func (v Version) Compare(o Version) int {
	switch {
	case v.Major != o.Major:
		return v.Major - o.Major
	case v.Minor != o.Minor:
		return v.Minor - o.Minor
	default:
		return v.Patch - o.Patch
	}
}

// ParseVersion parses a full version such as "v22.19.0" or "22.19.0";
// prerelease and build suffixes ("-rc.1", "+abc", Homebrew's "_1") are
// ignored.
func ParseVersion(s string) (Version, bool) {
	p, ok := parsePartial(s)
	if !ok || p.minor < 0 || p.patch < 0 {
		return Version{}, false
	}
	return Version{p.major, p.minor, p.patch}, true
}

// partial is a version with wildcards: -1 means "any" (20, 20.x, 20.11, *).
type partial struct{ major, minor, patch int }

func parsePartial(s string) (partial, bool) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(strings.TrimPrefix(s, "="), "v")
	if i := strings.IndexAny(s, "-+_"); i >= 0 {
		s = s[:i]
	}
	p := partial{-1, -1, -1}
	if s == "" || s == "*" || s == "x" || s == "X" {
		return p, true
	}
	parts := strings.Split(s, ".")
	if len(parts) > 3 {
		return p, false
	}
	fields := []*int{&p.major, &p.minor, &p.patch}
	for i, part := range parts {
		if part == "*" || part == "x" || part == "X" {
			// Everything after a wildcard is a wildcard too.
			return p, true
		}
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return p, false
		}
		*fields[i] = n
	}
	return p, true
}

// floor is the lowest version a partial covers.
func (p partial) floor() Version {
	return Version{max(p.major, 0), max(p.minor, 0), max(p.patch, 0)}
}

// ceiling is the first version above everything the partial covers; ok is
// false when it covers everything.
func (p partial) ceiling() (Version, bool) {
	switch {
	case p.major < 0:
		return Version{}, false
	case p.minor < 0:
		return Version{p.major + 1, 0, 0}, true
	case p.patch < 0:
		return Version{p.major, p.minor + 1, 0}, true
	default:
		return Version{p.major, p.minor, p.patch + 1}, true
	}
}

type comparator struct {
	op string // ">=", ">", "<", "<=", "="
	v  Version
}

func (c comparator) matches(v Version) bool {
	d := v.Compare(c.v)
	switch c.op {
	case ">=":
		return d >= 0
	case ">":
		return d > 0
	case "<":
		return d < 0
	case "<=":
		return d <= 0
	default:
		return d == 0
	}
}

// Range is an npm-style semver range: alternatives (||) of comparator sets
// that must all hold.
type Range [][]comparator

// Contains reports whether v satisfies the range.
func (r Range) Contains(v Version) bool {
	for _, set := range r {
		ok := true
		for _, c := range set {
			if !c.matches(v) {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

// ParseRange parses the range syntax package.json "engines" uses: "20",
// "20.x", "^18.17", "~20.1", ">=18 <21", "1.2 - 2.3", "18 || 20".
func ParseRange(s string) (Range, bool) {
	var out Range
	for _, alternative := range strings.Split(s, "||") {
		set, ok := parseSet(strings.TrimSpace(alternative))
		if !ok {
			return nil, false
		}
		out = append(out, set)
	}
	return out, len(out) > 0
}

func parseSet(s string) ([]comparator, bool) {
	if lo, hi, found := strings.Cut(s, " - "); found {
		from, ok1 := parsePartial(lo)
		to, ok2 := parsePartial(hi)
		if !ok1 || !ok2 {
			return nil, false
		}
		set := []comparator{{">=", from.floor()}}
		if ceiling, ok := to.ceiling(); ok {
			set = append(set, comparator{"<", ceiling})
		}
		return set, true
	}
	// Join operators written apart from their version (">= 18").
	var tokens []string
	pending := ""
	for _, field := range strings.Fields(s) {
		if strings.Trim(field, "<>=^~") == "" {
			pending += field
			continue
		}
		tokens = append(tokens, pending+field)
		pending = ""
	}
	if pending != "" {
		return nil, false
	}
	set := []comparator{}
	for _, token := range tokens {
		comparators, ok := parseComparator(token)
		if !ok {
			return nil, false
		}
		set = append(set, comparators...)
	}
	return set, true
}

func parseComparator(token string) ([]comparator, bool) {
	op := ""
	for _, candidate := range []string{">=", "<=", "~>", ">", "<", "=", "^", "~"} {
		if strings.HasPrefix(token, candidate) {
			op, token = candidate, token[len(candidate):]
			break
		}
	}
	p, ok := parsePartial(token)
	if !ok {
		return nil, false
	}
	between := func(lo Version, hi Version, bounded bool) []comparator {
		set := []comparator{{">=", lo}}
		if bounded {
			set = append(set, comparator{"<", hi})
		}
		return set
	}
	full := p.patch >= 0
	switch op {
	case "^":
		if p.major < 0 {
			return nil, true
		}
		var hi Version
		switch {
		case p.major > 0 || p.minor < 0:
			hi = Version{p.major + 1, 0, 0}
		case p.minor > 0 || p.patch < 0:
			hi = Version{0, p.minor + 1, 0}
		default:
			hi = Version{0, 0, p.patch + 1}
		}
		return between(p.floor(), hi, true), true
	case "~", "~>":
		if p.major < 0 {
			return nil, true
		}
		if p.minor < 0 {
			return between(p.floor(), Version{p.major + 1, 0, 0}, true), true
		}
		return between(p.floor(), Version{p.major, p.minor + 1, 0}, true), true
	case ">=":
		return []comparator{{">=", p.floor()}}, true
	case ">":
		if full {
			return []comparator{{">", p.floor()}}, true
		}
		hi, ok := p.ceiling()
		if !ok {
			// ">*" matches nothing.
			return []comparator{{"<", Version{}}}, true
		}
		return []comparator{{">=", hi}}, true
	case "<":
		return []comparator{{"<", p.floor()}}, true
	case "<=":
		if full {
			return []comparator{{"<=", p.floor()}}, true
		}
		hi, ok := p.ceiling()
		if !ok {
			return nil, true
		}
		return []comparator{{"<", hi}}, true
	default:
		if full {
			return []comparator{{"=", p.floor()}}, true
		}
		hi, ok := p.ceiling()
		return between(p.floor(), hi, ok), true
	}
}
