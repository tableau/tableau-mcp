## Example

```json
{
  "name": "Sales",
  "projectId": "cbec32db-a4a2-4308-b5f0-4fc67322f359",
  "datasourceFilePath": "/path/to/Sales.tdsx",
  "overwrite": false
}
```

## Result

On success, `status` is `published`, `data` contains the parsed datasource response, and `url` is
the returned `webpageUrl` (or an empty string if Tableau omits it). Tableau validates the datasource
as part of publishing; rejected publications return an error.
