FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /server ./cmd/server && mkdir /data

FROM gcr.io/distroless/static:nonroot
COPY --from=build /server /server
COPY --from=build --chown=65532:65532 /data /data
ENV DB_PATH=/data/chat.db PORT=8081
EXPOSE 8081
USER nonroot
ENTRYPOINT ["/server"]
