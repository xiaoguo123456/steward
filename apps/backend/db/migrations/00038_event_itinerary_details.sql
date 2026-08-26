-- +goose Up
ALTER TABLE events
    ADD COLUMN itinerary_details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE events
    ADD CONSTRAINT events_itinerary_details_object_check
        CHECK (jsonb_typeof(itinerary_details) = 'object');

-- +goose Down
ALTER TABLE events DROP CONSTRAINT events_itinerary_details_object_check;
ALTER TABLE events DROP COLUMN itinerary_details;
