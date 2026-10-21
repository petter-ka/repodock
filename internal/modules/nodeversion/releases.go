package nodeversion

import "time"

// endOfLife is the official end-of-life date of each Node.js release line
// (https://github.com/nodejs/Release). Lines newer than the table are
// treated as supported; extend it when a new line is announced.
var endOfLife = map[int]string{
	4: "2018-04-30", 5: "2016-06-30", 6: "2019-04-30", 7: "2017-06-30",
	8: "2019-12-31", 9: "2018-06-30", 10: "2021-04-30", 11: "2019-06-01",
	12: "2022-04-30", 13: "2020-06-01", 14: "2023-04-30", 15: "2021-06-01",
	16: "2023-09-11", 17: "2022-06-01", 18: "2025-04-30", 19: "2023-06-01",
	20: "2026-04-30", 21: "2024-06-01", 22: "2027-04-30", 23: "2025-06-01",
	24: "2028-04-30", 25: "2026-06-01", 26: "2029-04-30",
}

// IsEOL reports whether the release line of major is past its end of life
// at now. 0.x and the io.js-era 1–3 lines are long gone.
func IsEOL(major int, now time.Time) bool {
	if major < 4 {
		return true
	}
	date, ok := endOfLife[major]
	if !ok {
		return false
	}
	end, err := time.ParseInLocation("2006-01-02", date, time.UTC)
	return err == nil && !now.Before(end)
}

// ltsCodenames maps the "lts/<name>" aliases of nvm and fnm to their
// release line.
var ltsCodenames = map[string]int{
	"argon": 4, "boron": 6, "carbon": 8, "dubnium": 10, "erbium": 12, "fermium": 14,
	"gallium": 16, "hydrogen": 18, "iron": 20, "jod": 22, "krypton": 24,
}

// isLTSLine reports whether a release line gets long-term support (every
// even line since 4).
func isLTSLine(major int) bool { return major >= 4 && major%2 == 0 }
