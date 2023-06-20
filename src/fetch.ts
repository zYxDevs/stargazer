import {z} from 'zod';

export const stargazerSchema = z.object({
	avatarUrl: z.string(),
	name: z.string(),
	date: z.string(),
});

export type Stargazer = z.infer<typeof stargazerSchema>;

export async function fetchStargazers({
	repoOrg,
	repoName,
	starCount,
	abortSignal,
}: {
	repoOrg: string;
	repoName: string;
	starCount: number;
	abortSignal: AbortSignal;
}) {
	let starsLeft = starCount;
	let cursor = null;
	let allStargazers: Stargazer[] = [];

	console.log('Fetching stars...');
	while (starsLeft > 0) {
		const count = Math.min(starsLeft, 100);
		const result = await fetchPage({
			repoOrg,
			repoName,
			count,
			cursor,
			abortSignal,
		});

		const {cursor: newCursor, page} = result;
		allStargazers = [...allStargazers, ...page];
		console.log('Fetched ', allStargazers.length, ' stars');
		cursor = newCursor;
		if (page.length < count) {
			starsLeft = 0;
		} else {
			starsLeft -= page.length;
		}
	}

	return allStargazers;
}

async function fetchPage({
	repoOrg,
	repoName,
	count,
	cursor,
	abortSignal,
}: {
	repoOrg: string;
	repoName: string;
	count: number;
	cursor: string | null;
	abortSignal: AbortSignal;
}): Promise<{cursor: string; page: Stargazer[]}> {
	const query = `{
		repository(owner: "${repoOrg}", name: "${repoName}") {
			stargazers(first: ${count}${cursor ? `, after: "${cursor}"` : ''}) {
				edges {
					starredAt
					node {
						avatarUrl
						name
						login
					}
					cursor
				}
			}
		}
	}`;

	if (!process.env.REMOTION_GITHUB_TOKEN) {
		throw new TypeError(
			'You need to set a REMOTION_GITHUB_TOKEN environment variable'
		);
	}

	const res = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			authorization: `token ${process.env.REMOTION_GITHUB_TOKEN}`,
		},
		signal: abortSignal,
		body: JSON.stringify({query}),
	});

	if (!res.ok) {
		const textResponse = await res.text();
		throw Error(`HTTP ${res.status} ${res.statusText}: ${textResponse}`);
	}

	const json = (await res.json()) as GitHubApiResponse;
	if ('errors' in json) {
		if (json.errors[0].type === 'RATE_LIMITED') {
			console.log('Rate limit exceeded, waiting 1 minute...');
			await new Promise((resolve) => {
				setTimeout(resolve, 60 * 1000);
			});
			return fetchPage({repoOrg, repoName, count, cursor, abortSignal});
		}
		throw new Error(JSON.stringify(json.errors));
	}
	if (!json.data) {
		throw new Error(JSON.stringify(json));
	}
	const {edges} = json.data.repository.stargazers;
	const lastCursor = edges[edges.length - 1].cursor;
	const page: Stargazer[] = edges.map((edge) => {
		return {
			avatarUrl: edge.node.avatarUrl,
			date: edge.starredAt,
			name: edge.node.name || edge.node.login,
		};
	});
	return {cursor: lastCursor, page};
}

type GitHubApiResponse =
	| {
			data: {
				repository: {
					stargazers: {
						edges: Edge[];
					};
				};
			};
	  }
	| {
			errors: ApiError[];
	  };

type Edge = {
	starredAt: string;
	node: {
		avatarUrl: string;
		name?: string;
		login: string;
	};
	cursor: string;
};

type ApiError =
	| {
			type: 'RATE_LIMITED';
			message: string;
	  }
	| {
			type: string;
			message: string;
	  };
