# Gmail Accounts Template

Use unique topic, subscription, port, and path per account.

| Account Label | Email | Topic | Subscription | Port | Path |
| --- | --- | --- | --- | --- | --- |
| ACCOUNT1 | you@example.com | gog-gmail-watch-account1 | gog-gmail-watch-push-account1 | 8788 | /gmail-pubsub-account1 |
| ACCOUNT2 | you2@example.com | gog-gmail-watch-account2 | gog-gmail-watch-push-account2 | 8789 | /gmail-pubsub-account2 |
| ACCOUNT3 | you3@example.com | gog-gmail-watch-account3 | gog-gmail-watch-push-account3 | 8790 | /gmail-pubsub-account3 |

Naming suggestions
- Label: lowercase, no spaces
- Topic: gog-gmail-watch-<label>
- Subscription: gog-gmail-watch-push-<label>
- Path: /gmail-pubsub-<label>
- Port: use a unique port per account

Notes
- Run `gog auth login` for the account you are configuring.
- Keep a record of which account owns each topic/subscription.
