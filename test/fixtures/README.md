# Test fixtures

| File | What it is | Source | License |
| --- | --- | --- | --- |
| `office.jpg` | Open office with windows and a plant, cropped to 16:9 and scaled to 1280x720 | [Office (Unsplash VWcPlbHglYc)](https://commons.wikimedia.org/wiki/File:Office_(Unsplash_VWcPlbHglYc).jpg), Alesia Kazantceva | CC0 1.0 |
| `lounge.jpg` | Office lounge, cropped to 16:9 and scaled to 1280x720; the virtual background | [Office rest area (Unsplash)](https://commons.wikimedia.org/wiki/File:Office_rest_area_(Unsplash).jpg), Breather | CC0 1.0 |
| `robot-office.jpg` | The camera frame: a white robot doll drawn over `office.jpg` | Derived from `office.jpg` | CC0 1.0 |
| `robot-office-mask.png` | The robot's exact silhouette: 0 for the person, 255 for the background, as the pipeline reads MediaPipe's category mask | Derived from `robot-office.jpg` | CC0 1.0 |

The robot was drawn with canvas 2D shapes (head, neck and shoulders, shaded white) over the office
photo, and the mask is the same silhouette, thresholded to a binary mask. Drawing the person rather
than photographing one keeps real people out of the tests and makes the mask ground truth: the
tests cover the WebGL compositing, not the segmentation model.
