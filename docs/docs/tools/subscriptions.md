---
sidebar_position: 14
---

# Email subscriptions

Use these tools to manage scheduled email snapshots of workbooks and views for the signed-in Tableau
user. These are separate from Tableau Pulse metric subscriptions.

| Tool                   | Behavior                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| `list-subscriptions`   | List your accessible Workbook/View subscriptions and their suspension state. |
| `create-subscription`  | Create a subscription for yourself with an email subject and schedule.       |
| `suspend-subscription` | Pause delivery while preserving the subscription and schedule.               |
| `resume-subscription`  | Enable delivery again using the existing schedule.                           |

The `subscriptions` tool group includes all four tools. OAuth clients need
`tableau:mcp:subscriptions:read` for listing and `tableau:mcp:subscriptions:write` for changes. The
underlying REST scopes are `tableau:tasks:read`, `tableau:tasks:create`, and `tableau:tasks:update`
as applicable, plus the content-access scopes. PAT authentication uses the same site permissions.
Only the authenticated user's subscriptions are supported, including when the user is an
administrator.

Tableau must have subscriptions enabled and an email address configured for the user. The user must
have access to the content and permission to subscribe. All configured project, workbook, view, and
tag restrictions apply to their relevant content types.

## List subscriptions

```json
{ "contentType": "Workbook", "pageNumber": 1 }
```

Each call inspects one 100-item source page, then removes subscriptions belonging to other users or
inaccessible content and applies optional `contentType` and `contentId` filters. Follow
`nextPageNumber` until absent; a filtered page can be empty and still have a continuation. The
response does not expose a site-wide total. `limit` caps the returned items on the same source page
and does not change page boundaries. Omit it when enumerating all matches. Administrator result
limits also apply.

## Create a subscription

Tableau Cloud uses custom schedules (REST API 3.20 or later). Creator or Explorer is required for a
custom subscription schedule. Specify times in five-minute increments and confirm the subscription
timezone in Tableau before scheduling:

```json
{
  "contentType": "View",
  "contentId": "11111111-1111-4111-8111-111111111111",
  "subject": "Weekly sales report",
  "suspended": true,
  "schedule": {
    "frequency": "Weekly",
    "frequencyDetails": {
      "start": "09:00:00",
      "intervals": { "interval": [{ "weekDay": "Monday" }] }
    }
  }
}
```

Tableau Server uses an existing schedule whose type is Subscription. Replace `schedule` with
`{"id":"22222222-2222-4222-8222-222222222222"}`. Cloud and Server schedule forms are not
interchangeable.

Supported Cloud frequencies are Hourly, Daily, Weekly, and Monthly. Hourly requires a one-hour
interval, weekdays, and an end time. Daily requires weekdays and an interval of 2, 4, 6, 8, 12, or
24 hours; intervals below 24 hours also require an end time. Weekly takes one weekday. Monthly takes
day numbers (1–31), LastDay, or an ordinal weekday such as Third Thursday. Invalid combinations are
rejected before creation.

`attachImage` and `attachPdf` control attachments subject to site settings. Enable at least one
delivery format. `sendIfViewEmpty` applies only to View subscriptions. `suspended: true` creates a
paused subscription. Otherwise, Tableau can send email when its schedule runs. Confirm the content,
subject, and schedule before creating. Repeated create calls produce separate subscriptions; inspect
the list before retrying after an uncertain response.

## Suspend and resume

Call either tool with `{"subscriptionId":"33333333-3333-4333-8333-333333333333"}` using an ID from
listing or creation. Both operations verify ownership and current content access. Repeating an
operation already in the desired state leaves it unchanged. Neither operation recreates the
subscription or replaces its schedule.

Tableau enforces subscription availability, schedule validity, account email, and user permissions.
Permission errors, a disabled site setting, or an unsupported schedule must be resolved in Tableau
before retrying. See the
[Tableau REST subscription reference](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_subscriptions.htm).
