# B12k Independent Validation

Self-validation evidence for projcore gate.

- Route test confirms project list/read includes `latest_parent_status` from attached workflow state and keeps active run counts.
- Build confirms TypeScript route/service/type changes compile and static web assets copy.
- Browser proof at `localhost:3101/#/overmind-projects` confirms:
  - edit modal shows immutable `slug` and `app_path`, updates `parent_session`, refreshes, and closes;
  - active-run delete surfaces `project has active runs; complete or cancel them first` and keeps the row;
  - zero-active delete removes the row;
  - yellow warnings render for `bare-bash`/`no-session`;
  - an `ok` project renders without the yellow warning.
