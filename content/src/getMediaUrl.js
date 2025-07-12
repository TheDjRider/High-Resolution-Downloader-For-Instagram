const srcsetParser = require('srcset');
const jsonPath = require('jsonpath');

const srcsetIncludesSrc = (srcset, src) => {
  const sources = srcsetParser
    .parse(srcset)
    .map(source => {
      return source.url;
    })
    .includes(src);
};

const pickBiggestSourceFromSrcset = ({ srcset, src }) => {
  const allSources = srcsetIncludesSrc(srcset, src)
    ? srcsetParser.parse(srcset)
    : srcsetParser.parse(srcset).concat([{ url: src }]);

  const sourcesWithBytesize = allSources.map(source => {
    return fetch(source.url)
      .then(response => response.blob())
      .then(({ size: bytesize }) => Object.assign(source, { bytesize }));
  });

  return Promise.all(sourcesWithBytesize).then(sources => {
    sources.sort((first, second) => {
      if (first.bytesize > second.bytesize) return -1;
      if (first.bytesize < second.bytesize) return 1;
      return 0;
    });

    return sources[0].url;
  });
};

const getIGID = () => {
  const sortedArray = location.pathname
    .split('/')
    .filter(i => i.length && i !== 'p' && i !== 'reel' && i !== 'tv')
    .sort((a, b) => b.length - a.length);
  return sortedArray[0];
};

const getStoryID = () => {
  // Extract story ID from URL for stories
  const path = location.pathname;
  if (path.includes('/stories/')) {
    const matches = path.match(/\/stories\/([^/]+)\/(\d+)/);
    if (matches && matches.length >= 3) {
      return { username: matches[1], storyId: matches[2] };
    }
    // If no specific story ID, just extract username
    const usernameMatch = path.match(/\/stories\/([^/]+)/);
    if (usernameMatch && usernameMatch.length >= 2) {
      return { username: usernameMatch[1], storyId: null };
    }
  }
  return null;
};

const getPostType = () => {
  const path = location.pathname;
  if (path.includes('/p/')) return 'post';
  if (path.includes('/reel/')) return 'reel';
  if (path.includes('/tv/')) return 'tv';
  if (path.includes('/stories/')) return 'story';
  return 'post'; // Default to post type
};

const getGraphQLResponse = id => {
  const postType = getPostType();

  // Special handling for stories
  if (postType === 'story') {
    return fetchStoryData();
  }

  // For regular posts, reels, and TV
  const endpoint = `https://www.instagram.com/${postType}`;
  const params = '?__a=1&__d=dis';
  const url = [endpoint, id, params].join('/');

  return fetch(url)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to fetch from ${url}. Status: ${response.status}`);
      }
      return response.json();
    })
    .catch(error => {
      console.error('Error fetching Instagram data:', error);
      // Fallback to alternative API endpoint
      return fetchAlternativeAPI(id, postType);
    });
};

const fetchAlternativeAPI = (id, postType) => {
  // Alternative data fetching method using public API
  const url = `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables={"shortcode":"${id}"}`;

  return fetch(url)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to fetch from alternative API. Status: ${response.status}`);
      }
      return response.json();
    });
};

const fetchStoryData = () => {
  // First, try direct method - get data from MSE (Media Source Extensions)
  try {
    // Check if we can access the video element directly
    const videoElements = document.querySelectorAll('video');
    if (videoElements.length > 0) {
      // Try to extract media source URL from video sources
      for (const video of videoElements) {
        // Check if video has readable source
        if (video.src && !video.src.startsWith('blob:')) {
          return Promise.resolve({ directVideoUrl: video.src });
        }

        // Check if there's a poster that contains high-res image
        if (video.poster) {
          return Promise.resolve({ directVideoUrl: video.poster });
        }

        // Look for source elements
        const sources = video.querySelectorAll('source');
        for (const source of sources) {
          if (source.src && !source.src.startsWith('blob:')) {
            return Promise.resolve({ directVideoUrl: source.src });
          }
        }
      }
    }

    // Try to find source URLs in media elements (audio/video) through browser's media registry
    if (window.performance && window.performance.getEntriesByType) {
      const resources = window.performance.getEntriesByType('resource');
      const mediaResources = resources.filter(resource =>
        resource.name.includes('.mp4') ||
        resource.name.includes('/video/') ||
        resource.name.includes('/media/') ||
        resource.initiatorType === 'media'
      );

      if (mediaResources.length > 0) {
        // Sort by size (if available) or recency
        mediaResources.sort((a, b) => {
          if (a.encodedBodySize && b.encodedBodySize) {
            return b.encodedBodySize - a.encodedBodySize;
          }
          return b.startTime - a.startTime;
        });

        return Promise.resolve({ directVideoUrl: mediaResources[0].name });
      }
    }

    // Check for Instagram's internal variables
    if (window.__additionalData) {
      return Promise.resolve({ additionalData: window.__additionalData });
    }

    // Try to extract data from window._sharedData or window.__additionalData
    if (window._sharedData && window._sharedData.entry_data &&
        window._sharedData.entry_data.StoriesPage) {
      return Promise.resolve(window._sharedData);
    }

    // Look for script tags with JSON content that might contain the media URLs
    const scriptTags = document.querySelectorAll('script[type="application/json"]');
    for (const script of scriptTags) {
      try {
        const data = JSON.parse(script.textContent);
        if (data) {
          return Promise.resolve({ scriptData: data });
        }
      } catch (e) {}
    }

    // Look specifically for Instagram's client-side cache data
    const instagramDataScripts = Array.from(document.querySelectorAll('script')).filter(
      script => script.textContent.includes('window.__additionalDataLoaded')
    );

    if (instagramDataScripts.length > 0) {
      const dataScript = instagramDataScripts[0].textContent;
      const dataMatch = dataScript.match(/window\.__additionalDataLoaded\([^,]+,\s*({.+})\);/);
      if (dataMatch && dataMatch[1]) {
        try {
          const parsedData = JSON.parse(dataMatch[1]);
          return Promise.resolve({ parsedCacheData: parsedData });
        } catch (e) {}
      }
    }

    // If we can't find the data in the window object or DOM, we'll try API calls
    const storyInfo = getStoryID();
    if (storyInfo) {
      // Try multiple API endpoints
      // 1. Private API endpoint for stories
      return fetch(`https://i.instagram.com/api/v1/feed/user/${storyInfo.username}/story/`, {
        headers: {
          'x-ig-app-id': '936619743392459'
        }
      })
      .then(response => {
        if (response.ok) return response.json();
        throw new Error('Failed to fetch from private API');
      })
      .catch(() => {
        // 2. Alternative public API endpoint
        return fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${storyInfo.storyId || storyInfo.username}`, {
          headers: {
            'x-ig-app-id': '936619743392459'
          }
        })
        .then(response => {
          if (response.ok) return response.json();
          throw new Error('Failed to fetch from reels API');
        })
        .catch(() => {
          // 3. Try user profile endpoint as last resort
          return fetch(`https://www.instagram.com/${storyInfo.username}/?__a=1`)
            .then(response => {
              if (response.ok) return response.json();
              throw new Error('All API endpoints failed');
            });
        });
      });
    }

    throw new Error('Could not find story data');
  } catch (error) {
    console.error('Error fetching story data:', error);
    return Promise.reject(error);
  }
};

const extractVideoUrl = (response, postType) => {
  try {
    // Try multiple paths to find video URL based on response structure and post type
    let videoUrl;

    // Direct video URL from our enhanced fetch methods
    if (response.directVideoUrl) {
      return response.directVideoUrl;
    }

    // Special handling for stories
    if (postType === 'story') {
      // Try extracting from various story data structures

      // Try to use media resources from the page directly
      if (window.performance && window.performance.getEntriesByType) {
        const resources = window.performance.getEntriesByType('resource');
        const videoResource = resources.find(resource =>
          resource.name.includes('.mp4') &&
          !resource.name.includes('blob:')
        );

        if (videoResource) {
          return videoResource.name;
        }
      }

      // Try extracting from parsed cache data
      if (response.parsedCacheData) {
        const data = response.parsedCacheData;
        const videoUrls = jsonPath.query(data, '$..video_versions[*].url');
        if (videoUrls && videoUrls.length > 0) {
          return videoUrls[0];
        }
      }

      // Try extracting from script data
      if (response.scriptData) {
        const videoUrls = jsonPath.query(response.scriptData, '$..video_versions[*].url');
        if (videoUrls && videoUrls.length > 0) {
          return videoUrls[0];
        }
      }

      // From Redux store or additional data
      if (response.storeData || response.additionalData) {
        const dataSource = response.storeData || response.additionalData;
        const videoPathsToTry = [
          '$..reels_media[0].items[0].video_versions[0].url',
          '$..stories_tray[0].items[0].video_versions[0].url',
          '$..tray[0].items[0].video_versions[0].url',
          '$..story.items[0].video_versions[0].url'
        ];

        for (const path of videoPathsToTry) {
          videoUrl = jsonPath.query(dataSource, path)[0];
          if (videoUrl) return videoUrl;
        }
      }

      // From stories API
      videoUrl = jsonPath.query(response, '$..items[0].video_versions[0].url')[0];
      if (videoUrl) return videoUrl;

      // Try other common story paths
      const storyPaths = [
        '$..story.items[0].video_versions[0].url',
        '$..reel.items[0].video_versions[0].url',
        '$..reels.items[0].video_versions[0].url',
        '$..entry_data.StoriesPage[0].user.story.items[0].video_versions[0].url',
        '$..media_preview_payload.reels_media[0].items[0].video_versions[0].url',
        '$..data.reels_media[0].items[0].video_versions[0].url',
        '$..items[0].videoresources[0].src',
        '$..video_resources[0].src'
      ];

      for (const path of storyPaths) {
        videoUrl = jsonPath.query(response, path)[0];
        if (videoUrl) return videoUrl;
      }

      // If we can't find a video URL but can find an image URL as fallback for story image
      const imagePaths = [
        '$..items[0].image_versions2.candidates[0].url',
        '$..story.items[0].image_versions2.candidates[0].url',
        '$..reels_media[0].items[0].image_versions2.candidates[0].url',
        '$..entry_data.StoriesPage[0].user.story.items[0].image_versions2.candidates[0].url'
      ];

      for (const path of imagePaths) {
        videoUrl = jsonPath.query(response, path)[0];
        if (videoUrl) return videoUrl;
      }

      // Last resort - try to find any URL that looks like media
      const allUrls = JSON.stringify(response).match(/https:\/\/[^"']+\.(mp4|jpg|png|webp)/g);
      if (allUrls && allUrls.length > 0) {
        // Prioritize mp4 files
        const mp4Urls = allUrls.filter(url => url.endsWith('.mp4'));
        return mp4Urls.length > 0 ? mp4Urls[0] : allUrls[0];
      }
    }

    // Regular post paths - remaining code unchanged
    videoUrl = jsonPath.query(response, '$..video_url')[0];
    if (videoUrl) return videoUrl;

    // Path for reels
    videoUrl = jsonPath.query(response, '$..shortform_video_url')[0];
    if (videoUrl) return videoUrl;

    // Path for alternative API response structure
    videoUrl = jsonPath.query(response, '$.data.shortcode_media.video_url')[0];
    if (videoUrl) return videoUrl;

    // For TV/IGTV videos
    videoUrl = jsonPath.query(response, '$..video_versions[0].url')[0];
    if (videoUrl) return videoUrl;

    // Last attempt - general video paths
    const videoPaths = [
      '$..items[0].video_versions[0].url',
      '$..media[0].video_versions[0].url',
      '$..edge_sidecar_to_children.edges[0].node.video_url',
      '$..video_resources[0].src',
      '$..videoData.video_url'
    ];

    for (const path of videoPaths) {
      videoUrl = jsonPath.query(response, path)[0];
      if (videoUrl) return videoUrl;
    }

    throw new Error('Could not find video URL in the response');
  } catch (error) {
    console.error('Error extracting video URL:', error);
    return null;
  }
};

const pickFirstSourceElement = sources => Promise.resolve(sources[0].src);

const mediaIsVideoBlob = media => {
  const src = media.src || media.currentSrc;
  return src && src.slice(0, 5) === 'blob:';
};

const isVideo = media => {
  return media.tagName === 'VIDEO' || media instanceof HTMLVideoElement;
};

export const getMediaUrl = media => {
  const postType = getPostType();

  // Special handling for stories
  if (postType === 'story') {
    if (isVideo(media) && mediaIsVideoBlob(media)) {
      // For story videos with blob URLs, use them directly
      console.log("Story video detected, using blob URL directly:", media.src || media.currentSrc);
      return Promise.resolve(media.src || media.currentSrc);
    } else if (media.srcset) {
      // For story images with srcset
      return pickBiggestSourceFromSrcset(media);
    } else if ((media.src || media.currentSrc) && !mediaIsVideoBlob(media)) {
      // For story images with direct URLs
      const imgSrc = media.src || media.currentSrc;

      // If it's already a high-res image, use it directly
      if (imgSrc.includes('1080x') || imgSrc.includes('1080w')) {
        return Promise.resolve(imgSrc);
      }

      // Try to extract a higher resolution version from the same URL pattern
      if (imgSrc.match(/(_[0-9]+)\.[a-zA-Z0-9]+(\?.*)?$/)) {
        // Replace the resolution with the highest common one (1080)
        const highResUrl = imgSrc.replace(/(_[0-9]+)\.[a-zA-Z0-9]+(\?.*)?$/, '_1080.$2');
        console.log("Generated high-res story image URL:", highResUrl);
        return Promise.resolve(highResUrl);
      }

      return Promise.resolve(imgSrc);
    }
  }

  // Regular handling for posts, reels, etc.
  if (media.srcset) {
    return pickBiggestSourceFromSrcset(media);
  } else if (media.childElementCount) {
    return pickFirstSourceElement(media.children);
  } else if (mediaIsVideoBlob(media)) {
    // For videos with blob URLs in regular posts, try to find source URL
    return getGraphQLResponse(getIGID())
      .then(response => {
        const videoUrl = extractVideoUrl(response, postType);
        if (!videoUrl) {
          throw new Error('Could not extract video URL');
        }
        return videoUrl;
      })
      .catch(error => {
        console.error('Failed to get video URL:', error);
        // Return original blob as fallback
        return Promise.resolve(media.src || media.currentSrc);
      });
  } else {
    // Default case for all other media
    return Promise.resolve(media.src || media.currentSrc);
  }
};
