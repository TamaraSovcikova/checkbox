-- Pin size, so pins can be sized to their content in the views.
--
-- `span`   = how many columns of the 4-column pin grid the card occupies.
--            Default 2 (half width) reproduces the old two-up layout exactly,
--            so existing pins do not move when this lands.
-- `height` = fixed body height in px; NULL means "grow with the content", which
--            is what every pin did before, so NULL is the right default.
ALTER TABLE pins ADD COLUMN span INTEGER NOT NULL DEFAULT 2;
ALTER TABLE pins ADD COLUMN height INTEGER;
