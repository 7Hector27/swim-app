-- Custom SQL migration file, put your code below! --
UPDATE availability_seasons SET weekend_end_time = end_time WHERE weekend_start_time IS NOT NULL;
