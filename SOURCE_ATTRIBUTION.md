# Source and asset attribution status

This note records what could and could not be verified from the project folder and supplied archive before publication.

## Referenced GitHub skills or code

The project owner reports that development referenced other GitHub skills. The exact repositories, paths, revisions, and license terms were not included in the archive or original project files available for review. No upstream URLs, source notices, or license files were found in the extracted project.

As a result, this project does **not** make an attribution or license claim for those references, and their terms have not been verified. This disclosure is not a substitute for permission, attribution, or license compliance. Before a public release, identify each referenced skill or code source, inspect the specific material used and its license, and add any required notices and license texts. If a source or license cannot be established, do not claim that the affected material is cleared for redistribution.

## Runtime services and tools

The repository does not bundle `mcode-tools`, a model provider, or an image-generation connector. The app expects an Anthropic Messages-compatible vision service and, for abstract motif generation, a locally configured `mcode-tools` connector. No repository URL, version, or license information for these external runtime components was supplied, so none is asserted here. Review their own documentation, terms, and licenses when installing or configuring them.

## Supplied demonstration images

The three images in `docs/images/` were supplied with the project-preparation request and copied without retouching or watermark removal:

- `street-entrance-original.jpeg` — supplied source photograph.
- `street-entrance-abstract-motif.png` — supplied abstract motif.
- `autumn-lake-editorial-poster.png` — supplied composed poster image.

The images' original creators and redistribution licenses were not provided or independently verified. Confirm permission to redistribute them before making the repository public. Visible watermarks remain intact.

## Project license

No project `LICENSE` file was present, and no license has been selected or added because source provenance and redistribution rights remain unresolved. The repository therefore does not grant users an open-source license. Select and add a license only after confirming that the project owner has the rights to license all included code and assets.
