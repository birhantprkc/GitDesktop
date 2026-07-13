- **PR detail no longer truncates commits, reviews, or conversation comments at 100.**
  A pull request with more than 100 commits, reviews, or conversation comments previously
  showed only the first 100 as if that were the whole list (GitHub's GraphQL connections
  cap there). The PR view now completes each list from the paginated REST API, matching how
  the changed-files rail already worked.
