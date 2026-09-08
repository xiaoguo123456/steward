FROM golang:1.26-alpine AS builder

RUN apk add --no-cache ca-certificates git
WORKDIR /src/apps/backend

COPY apps/backend/go.mod apps/backend/go.sum ./
RUN go mod download

COPY apps/backend ./
RUN mkdir -p /out \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/admin-api ./cmd/admin-api \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/cost-recalculate ./cmd/cost-recalculate

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S steward \
    && adduser -S -G steward -h /app steward

WORKDIR /app
COPY --from=builder /out/* /usr/local/bin/

USER steward
EXPOSE 8787 8788
CMD ["api"]
