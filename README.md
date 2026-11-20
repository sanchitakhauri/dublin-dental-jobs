# Dublin Dental Jobs

A public vacancy finder for dental nurses, dental assistants and dentists in Dublin, Wicklow and Kildare. It links to the listing on the source site; it does not accept applications.

The board imports active PortmanDentex vacancies from the [SmartRecruiters Posting API](https://developers.smartrecruiters.com/docs/posting-api). [Jooble Ireland](https://ie.jooble.org/api/about) is an optional additional source. The board publishes basic vacancy facts and links, not descriptions. Searches on LinkedIn, Indeed, HSE, JobsIreland and employer sites are provided separately; their listings aren't imported directly, and coverage is not comprehensive. [Indeed's job-search widget](https://docs.indeed.com/publisher-js-plugin/) requires partner approval, and [LinkedIn's Job Posting API](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview) is for approved posting integrations, not public job search. Salary is shown only when the source provides an unambiguous EUR hourly or annual rate. Distance is a straight-line estimate from the Sandyford area to a known town centre, not a journey estimate.

## Run locally

With Node.js 24 or later:

```sh
npm ci
npm test
npm run refresh
npm run build
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8000`. If the PortmanDentex feed fails, refresh marks its last published records as stale when a previous catalogue is available locally or at `SITE_URL`. It doesn't reuse old Jooble results after a failed Jooble refresh.

## Hosting and alerts

On GitHub Pages, select **GitHub Actions** as the publishing source. To publish manually, open **Actions → Refresh dental jobs and publish site → Run workflow** and select `main`. Selecting a branch with the verification job instead runs tests, refreshes the feeds, and builds without deploying. Check the `npm run refresh` log for each source's result; the site can build even if a source is unavailable.

After you are ready for automatic refresh and deployment, add the Actions repository variable `PUBLISH_DENTAL_JOBS` with the value `true` under **Settings → Secrets and variables → Actions → Variables**. That enables the job on pushes to `main` and on its hourly schedule. The page's refresh button reads the latest published snapshot; it does not trigger a cloud job. GitHub may delay scheduled runs or pause them after repository inactivity.

Browser alerts are opt-in and check for additions every five minutes while the page is open. To get PortmanDentex alerts when the page is closed, follow `data/openings.xml` in a reader that supports notifications. Other job sites may offer their own alerts. No email addresses or subscriptions are collected by this site.

## Enable Jooble Ireland

Request a country-specific key from the [Jooble Ireland API portal](https://ie.jooble.org/api/about). Check that your API agreement allows publishing a periodically refreshed snapshot on a public site. In the repository, go to **Settings → Secrets and variables → Actions → New repository secret** and save the key as `JOOBLE_IE_API_KEY`. Run the publishing workflow to activate it. For local refreshes, supply the same variable through your environment. Do not commit the key or put it in a repository variable.

The connector makes three requests per refresh (one result page per county), filters to the board's roles and counties, and sends visitors to the Jooble link for each result. A normal hourly schedule makes 72 requests per day, excluding any extra runs, so check your key's [request limits](https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation). Jooble results are displayed on the site, not included in its outgoing RSS feed. If the key is removed, the next publish drops Jooble results and keeps the PortmanDentex feed.
