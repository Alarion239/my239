package logger

import (
	"fmt"
	"runtime/debug"
)

// PanicError carries a recovered background-goroutine panic to its supervisor
// without logging it twice. The supervisor decides whether the failure is
// fatal and logs it once through the normal structured path.
type PanicError struct {
	Name  string
	Value any
	Stack []byte
}

func (e *PanicError) Error() string {
	return fmt.Sprintf("background goroutine %s panicked: %v", e.Name, e.Value)
}

// Guard runs fn and converts a panic at that goroutine boundary into a
// structured PanicError. It is deliberately not a blanket recover for request
// handlers; HTTP recovery has its own response-writing middleware.
func Guard(name string, fn func() error) (err error) {
	defer func() {
		if value := recover(); value != nil {
			err = &PanicError{Name: name, Value: value, Stack: append([]byte(nil), debug.Stack()...)}
		}
	}()
	return fn()
}
