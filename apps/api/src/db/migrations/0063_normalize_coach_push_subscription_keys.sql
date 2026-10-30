-- One-time fix for subscriptions registered with standard base64 keys
-- (characters +, /, trailing =). web-push's crypto layer only accepts
-- base64url and raises "Unsupported characters set use the URL or
-- filename-safe Base64 characters set", so every send to those rows
-- failed. Convert in place: + → -, / → _, strip trailing =. Keys that
-- are already base64url are unchanged. Register path now normalizes
-- too, so new rows won't need another pass.
UPDATE coach_push_subscriptions
SET
  p256dh = rtrim(translate(p256dh, '+/', '-_'), '='),
  auth = rtrim(translate(auth, '+/', '-_'), '=')
WHERE
  p256dh ~ '[+/=]' OR auth ~ '[+/=]';
