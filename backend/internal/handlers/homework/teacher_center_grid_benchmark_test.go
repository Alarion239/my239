package homework

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/Alarion239/my239/backend/internal/store"
)

func BenchmarkCenterGridAssembly(b *testing.B) {
	roster := make([]store.TeacherCenterGridRosterRow, 120)
	for i := range roster {
		roster[i] = store.TeacherCenterGridRosterRow{
			GroupID:          int64(i / 30),
			GroupName:        "Группа",
			StudentUserID:    int64(1000 + i),
			StudentFirstName: "Имя",
			StudentLastName:  "Фамилия",
		}
	}
	columns := make([]store.TeacherCenterGridColumnRow, 500)
	for i := range columns {
		columns[i] = store.TeacherCenterGridColumnRow{
			SeriesID:        int64(200 + i/10),
			SeriesNumber:    int32(1 + i/10),
			SeriesName:      "Серия",
			SeriesDueAt:     time.Unix(0, 0),
			SubproblemID:    int64(5000 + i),
			SubproblemLabel: "",
			ProblemID:       int64(7000 + i/2),
			ProblemNumber:   int32(i/2 + 1),
		}
	}
	cells := make([]store.TeacherCenterGridCellRow, 23207)
	for i := range cells {
		cells[i] = store.TeacherCenterGridCellRow{
			StudentUserID: int64(1000 + i%120),
			SubproblemID:  int64(5000 + i%500),
			ThreadID:      int64(i + 1),
			CurrentStatus: "accepted",
		}
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		response := buildCenterGridResponse(roster, columns, cells)
		encoded, err := json.Marshal(response)
		if err != nil {
			b.Fatal(err)
		}
		if i == 0 {
			b.ReportMetric(float64(len(encoded)), "json_bytes")
		}
	}
}
