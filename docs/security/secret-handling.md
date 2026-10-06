# Secret Handling

MVP:

- `.env*` files are read only after the user requests the Environment drawer.
- Values are displayed as editable text but are not logged.
- Save operations write directly to the selected file.

Future:

- masked-by-default values;
- reveal-on-demand;
- OS keychain integration for secrets introduced by RepoDock itself;
- secret change history with opt-in local encryption.

Do not treat a local-only application as automatically safe. A local app has the same permissions as the developer account that launches it.
