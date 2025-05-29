"""
Test Case Loader for Bird-Mini Dataset
Loads and filters test cases for california_schools, card_games, and financial databases
"""

import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class TestCase:
    """Represents a single test case from the bird-mini dataset"""
    question_id: int
    db_id: str
    question: str
    evidence: str
    sql: str
    difficulty: str
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation"""
        return {
            "question_id": self.question_id,
            "db_id": self.db_id,
            "question": self.question,
            "evidence": self.evidence,
            "sql": self.sql,
            "difficulty": self.difficulty
        }


class BirdMiniTestLoader:
    """Loads and manages test cases from the bird-mini dataset"""
    
    SUPPORTED_DATABASES = {"california_schools", "card_games", "financial"}
    
    def __init__(self, data_path: str = None):
        """
        Initialize the test loader
        
        Args:
            data_path: Path to the bird-mini data directory
        """
        self.data_path = Path(data_path) if data_path else Path(__file__).parent.parent / "bird_mini" / "data"
        self.logger = logging.getLogger(__name__)
        
        # Map database names to Tableau datasource names (if different)
        self.datasource_mapping = {
            "california_schools": "california_schools",
            "card_games": "card_games",
            "financial": "financial"
        }
        
    def load_test_cases(self, 
                       databases: Optional[List[str]] = None,
                       difficulty_filter: Optional[List[str]] = None,
                       limit: Optional[int] = None) -> List[TestCase]:
        """
        Load test cases from the dataset
        
        Args:
            databases: List of database IDs to include (defaults to all supported)
            difficulty_filter: List of difficulty levels to include (simple, moderate, challenging)
            limit: Maximum number of test cases to load per database
            
        Returns:
            List of TestCase objects
        """
        databases = databases or list(self.SUPPORTED_DATABASES)
        
        # Validate database names
        invalid_dbs = set(databases) - self.SUPPORTED_DATABASES
        if invalid_dbs:
            raise ValueError(f"Unsupported databases: {invalid_dbs}")
            
        # Try different file formats
        test_files = [
            self.data_path / "mini_dev_sqlite.json",
            self.data_path / "mini_dev_postgresql.json",
            self.data_path / "mini_dev_mysql.json"
        ]
        
        test_cases = []
        
        for test_file in test_files:
            if test_file.exists():
                self.logger.info(f"Loading test cases from {test_file}")
                
                with open(test_file, 'r') as f:
                    data = json.load(f)
                    
                # Filter and convert to TestCase objects
                for item in data:
                    if item["db_id"] not in databases:
                        continue
                        
                    if difficulty_filter and item["difficulty"] not in difficulty_filter:
                        continue
                        
                    test_case = TestCase(
                        question_id=item["question_id"],
                        db_id=item["db_id"],
                        question=item["question"],
                        evidence=item.get("evidence", ""),
                        sql=item["SQL"],
                        difficulty=item["difficulty"]
                    )
                    
                    test_cases.append(test_case)
                
                # We found a valid file, no need to check others
                break
        
        if not test_cases:
            raise ValueError(f"No test cases found for databases: {databases}")
            
        # Apply limit if specified
        if limit:
            # Group by database and limit each
            limited_cases = []
            for db in databases:
                db_cases = [tc for tc in test_cases if tc.db_id == db]
                limited_cases.extend(db_cases[:limit])
            test_cases = limited_cases
            
        self.logger.info(f"Loaded {len(test_cases)} test cases")
        
        return test_cases
    
    def get_test_cases_by_database(self, test_cases: List[TestCase]) -> Dict[str, List[TestCase]]:
        """
        Group test cases by database
        
        Args:
            test_cases: List of test cases
            
        Returns:
            Dictionary mapping database ID to list of test cases
        """
        grouped = {}
        for tc in test_cases:
            if tc.db_id not in grouped:
                grouped[tc.db_id] = []
            grouped[tc.db_id].append(tc)
            
        return grouped
    
    def get_tableau_datasource_name(self, db_id: str) -> str:
        """
        Get the Tableau datasource name for a given database ID
        
        Args:
            db_id: Database ID from bird-mini
            
        Returns:
            Corresponding Tableau datasource name
        """
        return self.datasource_mapping.get(db_id, db_id)
    
    def get_statistics(self, test_cases: List[TestCase]) -> Dict[str, Any]:
        """
        Get statistics about the loaded test cases
        
        Args:
            test_cases: List of test cases
            
        Returns:
            Dictionary with statistics
        """
        stats = {
            "total": len(test_cases),
            "by_database": {},
            "by_difficulty": {},
            "by_database_and_difficulty": {}
        }
        
        # Count by database
        for tc in test_cases:
            db = tc.db_id
            diff = tc.difficulty
            
            # By database
            stats["by_database"][db] = stats["by_database"].get(db, 0) + 1
            
            # By difficulty
            stats["by_difficulty"][diff] = stats["by_difficulty"].get(diff, 0) + 1
            
            # By database and difficulty
            if db not in stats["by_database_and_difficulty"]:
                stats["by_database_and_difficulty"][db] = {}
            stats["by_database_and_difficulty"][db][diff] = \
                stats["by_database_and_difficulty"][db].get(diff, 0) + 1
                
        return stats


# Example usage
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    loader = BirdMiniTestLoader()
    
    # Load all test cases for our three databases
    test_cases = loader.load_test_cases()
    
    # Get statistics
    stats = loader.get_statistics(test_cases)
    print(f"\nTest Case Statistics:")
    print(f"Total: {stats['total']}")
    print(f"\nBy Database:")
    for db, count in stats['by_database'].items():
        print(f"  {db}: {count}")
    print(f"\nBy Difficulty:")
    for diff, count in stats['by_difficulty'].items():
        print(f"  {diff}: {count}")
        
    # Show a few examples
    print(f"\nExample Test Cases:")
    for db in loader.SUPPORTED_DATABASES:
        db_cases = [tc for tc in test_cases if tc.db_id == db]
        if db_cases:
            tc = db_cases[0]
            print(f"\n{db}:")
            print(f"  Question: {tc.question}")
            print(f"  SQL: {tc.sql[:100]}...") 