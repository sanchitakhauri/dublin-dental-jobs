# Dublin Dental Jobs

A public vacancy finder for dental nurses, dental assistants and dentists in Dublin, Wicklow and Kildare. It links to the official adverts; it does not accept applications.

[Open the live Dublin Dental Jobs website](https://sanchitakhauri.github.io/dublin-dental-jobs/).

The board imports active PortmanDentex vacancies from the [SmartRecruiters Posting API](https://developers.smartrecruiters.com/docs/posting-api). It publishes basic vacancy facts and links, not descriptions. Searches on LinkedIn, Indeed, HSE, JobsIreland and other employer sites are provided separately; those listings are not imported, and coverage is not comprehensive. Salary is shown only when the advert publishes an unambiguous EUR hourly or annual rate. Distance is a straight-line estimate from the Sandyford area to a known town centre, not a journey estimate.

## Run locally

With Node.js 24 or later:

```sh
npm ci
npm test
npm run refresh
npm run build
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8000`. A feed outage displays a clear status rather than inventing results. If a previous catalogue is available locally or at `SITE_URL`, the refresh preserves it and marks it stale.

## Hosting and alerts

On GitHub Pages, select **GitHub Actions** as the publishing source. To publish manually, open **Actions → Refresh dental jobs and publish site → Run workflow**. After you are ready for automatic refresh and deployment, add the Actions repository variable `PUBLISH_DENTAL_JOBS` with the value `true` under **Settings → Secrets and variables → Actions → Variables**. That enables the job on pushes to `main` and on its hourly schedule. The page's refresh button reads the latest published snapshot; it does not trigger a cloud job. GitHub may delay scheduled runs or pause them after repository inactivity.

Browser alerts are opt-in and check for additions every five minutes while the page is open. To get alerts when the page is closed, follow `data/openings.xml` in a reader that supports notifications, or create alerts on the original job sites. No email addresses or subscriptions are collected by this site.

## CV privacy

Text-based PDFs and plain-text files are parsed in the browser using locally served PDF.js code. The CV is kept in page memory only. Suggestions are based on text and the selected role; they do not establish work rights or registration. CV downloads and print-to-PDF are local. Do not add CVs or personal details to this repository.
