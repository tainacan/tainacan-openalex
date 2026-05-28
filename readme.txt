=== Tainacan OpenAlex ===
Contributors: tainacan
Tags: tainacan, openalex, bibliography, metadata, abnt
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.4.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Search bibliographic works on OpenAlex and fill Tainacan item metadata from the item edit form.

== Description ==

**Tainacan OpenAlex Bibliografia** extends [Tainacan](https://wordpress.org/plugins/tainacan/) with an **OpenAlex (Bibliografia)** block in the item admin form. Editors can search scholarly works, pick a result, and have mapped metadata fields filled automatically. Click **Save** on the item to persist the values.

= Features =

* **OpenAlex search** in the item form: free text, title, author, DOI, or ISSN
* **Work details** loaded from OpenAlex when a result is selected
* **Metadata mapping** to Tainacan from OpenAlex fields (title, authors, year, DOI, venue, URL, ABNT reference)
* **ABNT-style reference** built from available fields (up to 3 authors, then "et al.")
* **Optional OpenAlex API key** for higher rate limits
* **Collection-scoped** so the block appears only on the references collection you choose

= How it works =

1. Open an item in the Tainacan admin.
2. In **OpenAlex (Bibliografia)**, choose the search type and run a query.
3. Click a result to fill the configured metadata fields.
4. Save the item.

Search behavior:

* **Free search / Title** — text search on OpenAlex works
* **Author** — resolves the first author match, then lists their works
* **DOI** — resolves the work directly by DOI
* **ISSN** — resolves the source by ISSN, then lists related works

= Configuration =

After activation, go to **Tainacan → Settings** and open the **OpenAlex Biblio** section:

* **References collection ID** — collection whose item form shows the OpenAlex block
* **OpenAlex API key** (optional)
* **Metadata mappings** — metadatum IDs for title, authors, year, DOI, venue, URL, and ABNT reference

== Installation ==

= Manual =

1. Copy the plugin folder to `wp-content/plugins/tainacan-openalex/` (or your chosen slug).
2. Ensure this structure:

`tainacan-openalex-biblio.php` and `assets/openalex-biblio.js`, `assets/openalex-biblio.css`

3. Activate the plugin under **Plugins** in WordPress.
4. Configure **Tainacan → Settings → OpenAlex Biblio**.

= ZIP =

Zip the plugin folder and upload via **Plugins → Add New → Upload Plugin**, then activate and configure as above.

== Frequently Asked Questions ==

= Does this plugin work without Tainacan? =

No. Tainacan must be installed and active.

= Why do I not see the OpenAlex block on every item? =

The block is registered only for the collection ID set in **References collection ID**.

= Does the plugin save the item automatically? =

No. It fills the form fields; you must click **Save** on the item.

= Is the ABNT output fully norm-compliant? =

It generates a practical, simplified ABNT-style string. It does not cover every ABNT variation.

== Changelog ==

= 0.4.0 =
* Admin Form Hook integration for OpenAlex bibliographic search
* Search by free text, title, author, DOI, and ISSN
* Metadata mapping and ABNT reference generation
* Tainacan settings section for collection and field mapping

== Upgrade Notice ==

= 0.4.0 =
Initial public release for OpenAlex bibliographic lookup in the Tainacan item form.
