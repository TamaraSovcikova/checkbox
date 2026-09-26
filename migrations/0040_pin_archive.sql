-- Archive a card instead of deleting it (#4). An archived card leaves every
-- page and the board, and stays restorable from the Cards page.
ALTER TABLE pins ADD COLUMN archived_at TEXT;
