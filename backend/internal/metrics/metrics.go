// Package metrics defines the Prometheus collectors exported by the service
// and the HTTP handler that serves them.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// RequestDuration and RequestsTotal are labeled by the chi route *pattern*
// (e.g. "/series/{seriesID}") rather than the raw path, so cardinality stays
// bounded by the number of routes instead of by user-supplied ids.
var (
	RequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "Duration of HTTP requests in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "route", "status"})

	RequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total number of HTTP requests.",
	}, []string{"method", "route", "status"})
)

// Handler serves the registered collectors in the Prometheus text format.
func Handler() http.Handler {
	return promhttp.Handler()
}
