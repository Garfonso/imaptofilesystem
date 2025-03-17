# Node.js TypeScript Template

[![Package Version][package-image]][package-url]
[![Dependencies Status][dependencies-image]][dependencies-url]
[![Build Status][build-image]][build-url]
[![Coverage Status][coverage-image]][coverage-url]
[![Open Issues][issues-image]][issues-url]
[![Commitizen Friendly][commitizen-image]][commitizen-url]

A complete Node.js project template using TypeScript and following general best practices.  It allows you to skip the tedious details for the following:

* Adding and configuring TypeScript support.
* Enabling TypeScript linting.
* Setting up unit tests and code coverage reports.
* Creating an NPM package for your project.
* Managing ignored files for Git and NPM.

Once you've enabled CI, test coverage, and dependency reports for your project, this README.md file shows how to add the badges shown above.  This project template even enables automated changelog generation as long as you follow [Conventional Commits](https://conventionalcommits.org), which is made simple through the included [Commitizen CLI](http://commitizen.github.io/cz-cli/).

## Contents

* [Project Creation](#project-creation)
* [Rebranding](#rebranding)
* [Managing Your Project](#managing-your-project)
    * [Initial Publish](#initial-publish)
    * [Recommended Development Workflow](#recommended-development-workflow)
    * [Publishing to NPMJS](#publishing-to-npmjs)
* [Contributing](#contributing)

### Development Workflow

#### Hot reload
Run `npm run serve` to start your development workflow with hot reload.

#### Build, test, deploy

These steps need to be performed whenever you make changes:

0. Write awesome code in the `src` directory.
1. Build (clean, lint, and transpile): `npm run build`
2. Create unit tests in the `test` directory.  If your code is not awesome, you may have to fix some things here.
3. Verify code coverage: `npm run cover:check`
4. Commit your changes using `git add` and `git cz`
5. Push to GitHub using `git push` and wait for the CI builds to complete.  Again, success depends upon the awesomeness of your code.

### NPMJS Updates

Follow these steps to update your NPM package:

0. Perform all development workflow steps including pushing to GitHub in order to verify the CI builds.  You don't want to publish a broken package!
1. Check to see if this qualifies as a major, minor, or patch release: `npm run changelog:unreleased`
2. Bump the NPM version following [Semantic Versioning](https://semver.org) by using **one** of these approaches:
	* Specify major, minor, or patch and let NPM bump it: `npm version [major | minor | patch] -m "chore(release): Bump version to %s."`
	* Explicitly provide the version number such as 1.0.0: `npm version 1.0.0 -m "chore(release): Bump version to %s."`
3. The push to GitHub is automated, so wait for the CI builds to finish.
4. Publishing the new version to NPMJS is also automated, but you must create a secret named `NPM_TOKEN` on your project.
5. Manually create a new release in GitHub based on the automatically created tag.

## Contributing

This section is here as a reminder for you to explain to your users how to contribute to the projects you create from this template.

### Attribution
Based on the [Node.js TypeScript Template](https://github.com/chriswells0/node-typescript-template.git) by [Chris Wells](https://chriswells.io).

[build-image]: https://img.shields.io/github/actions/workflow/status/chriswells0/node-typescript-template/ci-build.yaml?branch=master
[build-url]: https://github.com/chriswells0/node-typescript-template/actions/workflows/ci-build.yaml
[commitizen-image]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[commitizen-url]: http://commitizen.github.io/cz-cli
[coverage-image]: https://coveralls.io/repos/github/chriswells0/node-typescript-template/badge.svg?branch=master
[coverage-url]: https://coveralls.io/github/chriswells0/node-typescript-template?branch=master
[dependencies-image]: https://img.shields.io/librariesio/release/npm/typescript-template
[dependencies-url]: https://www.npmjs.com/package/typescript-template?activeTab=dependencies
[issues-image]: https://img.shields.io/github/issues/chriswells0/node-typescript-template.svg?style=popout
[issues-url]: https://github.com/chriswells0/node-typescript-template/issues
[package-image]: https://img.shields.io/npm/v/typescript-template
[package-url]: https://www.npmjs.com/package/typescript-template
[project-url]: https://github.com/chriswells0/node-typescript-template
