import logging


def get_logger(name):
    logger = logging.getLogger("tableau-prep-mcp." + name)
    logger.addHandler(logging.NullHandler())
    logger.propagate = False
    return logger
