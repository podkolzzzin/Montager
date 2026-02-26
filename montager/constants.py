"""
Montager constants and configuration.
"""

# Output video dimensions
OUTPUT_WIDTH = 1920
OUTPUT_HEIGHT = 1080

# Speech detection thresholds
MIN_SPEECH_DURATION = 2.0  # Minimum seconds before switching to speaker
WIDE_SHOT_THRESHOLD = 1.5  # If no one speaks longer than this, use wide shot

# Wide break settings for long segments
LONG_SPEAKER_THRESHOLD = 15.0  # Insert wide breaks for segments longer than this
WIDE_BREAK_INTERVAL = 8.0  # How often to insert wide breaks in long segments
WIDE_BREAK_DURATION = 2.0  # Duration of wide break cutaways
