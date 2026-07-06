- Very large pull requests now show their full diff and complete file list
  instead of failing or stopping at 100 files. When GitHub refuses the whole-PR
  diff (its 300-file limit) or caps the file list at 100, both are rebuilt from
  the paginated files API so every changed file appears in the rail and renders
  its hunks.
