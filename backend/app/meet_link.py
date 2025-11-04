import random
import string


def _random_group(length: int) -> str:
    # Use lowercase letters excluding easily confusable ones; mimic Meet style
    alphabet = "abcdefghijkmnopqrstuvwxyz"  # omit l to avoid confusion
    return "".join(random.choice(alphabet) for _ in range(length))


def generate_google_meet_link() -> str:
    """
    Generate a pseudo Google Meet URL with the familiar pattern
    like https://meet.google.com/abc-defg-hij

    Note: This does not create a meeting via Google APIs; it
    generates a join URL pattern suitable for sharing. Integrating
    with Google Calendar/Meet can replace this later.
    """
    parts = [_random_group(3), _random_group(4), _random_group(3)]
    code = "-".join(parts)
    return f"https://meet.google.com/{code}"

