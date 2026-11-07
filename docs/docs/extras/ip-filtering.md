---
sidebar_position: 4
---

# Tableau Cloud IP Filtering

If your Tableau Cloud site restricts access by IP address
([Tableau Cloud IP filtering](https://help.tableau.com/current/online/en-us/ip_filtering.htm)),
hosted Tableau MCP needs two changes before it can reach the site:

1. **Add Salesforce IP address ranges to the site allow list.** REST API calls from the hosted
   service come from Salesforce, so those ranges have to be allowed.
2. **Point each MCP client at the pod-level MCP endpoint.** Clients such as Claude and ChatGPT must
   use the endpoint for your site's Tableau Cloud pod, instead of the shared endpoint
   `https://mcp.tableau.com`.

## Limitations

- Every MCP client, for every user, has to be updated on its own.
- Not every client can use a custom endpoint. Slackbot in Slack cannot.

## Add Salesforce IP address ranges to your allow list

A site administrator does this step. Allowing the published Salesforce IP ranges lets hosted
Tableau MCP call your site.

1. Get the IP ranges. Open the published list at https://ip-ranges.salesforce.com/ip-ranges.json
   and use the Hyperforce ranges. For background, see
   [Salesforce Help article 000384438](https://help.salesforce.com/s/articleView?id=000384438&type=1)
   and the Hyperforce section.
2. Sign in to your Tableau Cloud site as a site administrator and open **Settings**.
   - On the **Security** tab, scroll to **IP Filtering**.
   - Select **Enable IP Filtering**. The page shows your current device's IP address.
   - Under **New IP Addresses and IP Ranges**, add the Salesforce ranges. You can add every
     Hyperforce range, or only the ranges for your site's region (for example, `us-west-2`; the
     region for each pod is in the table below). Either:
     - Enter one address and click **Add**, or
     - Open the dropdown, select **IP Address Bulk Editor**, and paste the ranges, one per line.
       Single addresses (`203.0.113.55`) and CIDR subnets (`203.0.113.0/24`) are both accepted.
   - Keep your existing VPN and office ranges on the list, and add the Salesforce ranges alongside
     them.

:::caution

If your current IP address is not on the allow list when you save, you can lock yourself out of the
site. Include the IP address shown on the page before you save.

:::

3. Click **Save**. Changes can take up to 15 minutes to apply.
4. Keep the list current. Salesforce ranges change, so review them periodically.

## Point MCP clients at the pod-level endpoint

The pod name is the hostname of your site. For example, if the site URL is
`https://prod-uswest-c.online.tableau.com/#/site/ExampleCompanySiteHere/home`, the pod is
`prod-uswest-c`. Find that hostname in the table below. The row gives the region (`us-west-2`) and
the Tableau MCP URL to configure:

`https://prod-dataplane3-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp`

| Pod URL | Region | Tableau MCP URL |
| ------- | ------ | --------------- |
| https://10ax.online.tableau.com/ | us-west-2 | https://prod-dataplane18-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp |
| https://10ay.online.tableau.com/ | us-west-2 | https://prod-dataplane8-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp |
| https://10az.online.tableau.com/ | us-west-2 | https://prod-dataplane11-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp |
| https://dub01.online.tableau.com/ | eu-central-1 | https://prod-dataplane10-tabhf-mcp-svc-tableau.sfdc-yzvdd4.svc.sfdcfc.net/tableau-mcp |
| https://eu-west-1a.online.tableau.com/ | eu-central-1 | https://prod-dataplane14-tabhf-mcp-svc-tableau.sfdc-yzvdd4.svc.sfdcfc.net/tableau-mcp |
| https://prod-apnortheast-a.online.tableau.com/ | ap-northeast-1 | https://prod-dataplane15-tabhf-mcp-svc-tableau.sfdc-mchho0.svc.sfdcfc.net/tableau-mcp |
| https://prod-apsoutheast-a.online.tableau.com/ | ap-southeast-2 | https://prod-dataplane16-tabhf-mcp-svc-tableau.sfdc-vwfla6.svc.sfdcfc.net/tableau-mcp |
| https://prod-apsoutheast-b.online.tableau.com/ | ap-southeast-1 | https://prod-dataplane22-tabhf-mcp-svc-tableau.sfdc-hvhps.svc.sfdcfc.net/tableau-mcp |
| https://prod-apsoutheast-c.online.tableau.com/ | ap-southeast-3 | https://prod-dataplane25-tabhf-mcp-svc-tableau.sfdc-y2jwzb.svc.sfdcfc.net/tableau-mcp |
| https://prod-ca-a.online.tableau.com/ | ca-central-1 | https://prod-dataplane5-tabhf-mcp-svc-tableau.sfdc-58ktaz.svc.sfdcfc.net/tableau-mcp |
| https://prod-ch-a.online.tableau.com/ | eu-central-2 | https://prod-dataplane27-tabhf-mcp-svc-tableau.sfdc-ei37dk.svc.sfdcfc.net/tableau-mcp |
| https://prod-in-a.online.tableau.com/ | ap-south-2 | https://prod-dataplane28-tabhf-mcp-svc-tableau.sfdc-ppgy19.svc.sfdcfc.net/tableau-mcp |
| https://prod-kr-a.online.tableau.com/ | ap-northeast-2 | https://prod-dataplane29-tabhf-mcp-svc-tableau.sfdc-5vdu9h.svc.sfdcfc.net/tableau-mcp |
| https://prod-uk-a.online.tableau.com/ | eu-west-2 | https://prod-dataplane12-tabhf-mcp-svc-tableau.sfdc-5pakla.svc.sfdcfc.net/tableau-mcp |
| https://prod-useast-a.online.tableau.com/ | us-east-1 | https://prod-dataplane7-tabhf-mcp-svc-tableau.sfdc-yfeipo.svc.sfdcfc.net/tableau-mcp |
| https://prod-useast-b.online.tableau.com/ | us-east-1 | https://prod-dataplane9-tabhf-mcp-svc-tableau.sfdc-yfeipo.svc.sfdcfc.net/tableau-mcp |
| https://prod-useast-c.online.tableau.com/ | us-east-1 | https://prod-dataplane24-tabhf-mcp-svc-tableau.sfdc-yfeipo.svc.sfdcfc.net/tableau-mcp |
| https://prod-uswest-c.online.tableau.com/ | us-west-2 | https://prod-dataplane3-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp |
| https://us-east-1.online.tableau.com/ | us-east-1 | https://prod-dataplane13-tabhf-mcp-svc-tableau.sfdc-yfeipo.svc.sfdcfc.net/tableau-mcp |
| https://us-west-2b.online.tableau.com/ | us-west-2 | https://prod-dataplane4-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp |

In each MCP client, set the server URL to the Tableau MCP URL from the table. Field names vary by
client. This shape works for clients that take a JSON config:

```json
{
  "mcpServers": {
    "tableau": {
      "transport": "http",
      "url": "https://prod-dataplane3-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp"
    }
  }
}
```

Restart the MCP client, reconnect to Tableau MCP, and confirm the connection works.
