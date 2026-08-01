package db

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestApplyPoolDefaults(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		url  string
		want pgxpool.Config
	}{
		{
			name: "application defaults",
			url:  "postgres://localhost/my239",
			want: pgxpool.Config{
				MaxConns:          defaultMaxConns,
				MinConns:          defaultMinConns,
				MaxConnLifetime:   defaultMaxConnLifetime,
				MaxConnIdleTime:   defaultMaxConnIdleTime,
				HealthCheckPeriod: defaultHealthCheck,
			},
		},
		{
			name: "explicit URL overrides",
			url: "postgres://localhost/my239?pool_max_conns=17&pool_min_conns=4" +
				"&pool_max_conn_lifetime=1h&pool_max_conn_idle_time=2m&pool_health_check_period=3m",
			want: pgxpool.Config{
				MaxConns:          17,
				MinConns:          4,
				MaxConnLifetime:   time.Hour,
				MaxConnIdleTime:   2 * time.Minute,
				HealthCheckPeriod: 3 * time.Minute,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := pgxpool.ParseConfig(tt.url)
			if err != nil {
				t.Fatalf("parse pool config: %v", err)
			}
			if err := applyPoolDefaults(tt.url, cfg); err != nil {
				t.Fatalf("apply pool defaults: %v", err)
			}
			if cfg.MaxConns != tt.want.MaxConns {
				t.Errorf("MaxConns: got %d, want %d", cfg.MaxConns, tt.want.MaxConns)
			}
			if cfg.MinConns != tt.want.MinConns {
				t.Errorf("MinConns: got %d, want %d", cfg.MinConns, tt.want.MinConns)
			}
			if cfg.MaxConnLifetime != tt.want.MaxConnLifetime {
				t.Errorf("MaxConnLifetime: got %s, want %s", cfg.MaxConnLifetime, tt.want.MaxConnLifetime)
			}
			if cfg.MaxConnIdleTime != tt.want.MaxConnIdleTime {
				t.Errorf("MaxConnIdleTime: got %s, want %s", cfg.MaxConnIdleTime, tt.want.MaxConnIdleTime)
			}
			if cfg.HealthCheckPeriod != tt.want.HealthCheckPeriod {
				t.Errorf("HealthCheckPeriod: got %s, want %s", cfg.HealthCheckPeriod, tt.want.HealthCheckPeriod)
			}
		})
	}
}
